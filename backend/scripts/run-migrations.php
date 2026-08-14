<?php
/**
 * run-migrations.php — PHP mysqli 版通用迁移执行器
 *
 * 为什么需要这个脚本：
 *   1. backend/migrations/migrate.js 用 filename.split('_')[0] 作为迁移ID，
 *      导致 070_checkup_items_import_mysql57.sql 与 070_fix_legacy_lodging_type.sql
 *      冲突，后者会被静默跳过；068/069 同样冲突。
 *   2. migrate.js 按 ";" 分割 + 过滤 "--" 注释行，会破坏带分号/注释的复杂 SQL。
 *   3. `mysql < file` 默认遇到第一条错误就停止，导致 ALTER 失败后 DELETE/INSERT 不再执行。
 *
 * 本脚本的策略：
 *   - 直接读取所有 0*.sql 文件，按文件名排序
 *   - 用 mysqli 逐条执行（自己实现 SQL 分割，正确处理字符串字面量里的分号和转义）
 *   - 单条语句报错只打印 warning，继续执行下一条（等价 mysql --force）
 *   - 不写 schema_migrations（避免 ID 冲突），完全幂等可重跑
 *
 * 用法：
 *   php run-migrations.php                # 跑全部 0*.sql
 *   php run-migrations.php 070            # 只跑文件名前缀匹配 070 的（注意：会同时匹配两个 070 文件）
 *   php run-migrations.php 070_checkup    # 只跑文件名包含 070_checkup 的
 */

// ============== 数据库配置（与 db.js 保持一致） ==============
$DB_HOST = getenv('DB_HOST') ?: 'localhost';
$DB_USER = getenv('DB_USER') ?: 'food_purchase';
$DB_PASS = getenv('DB_PASSWORD') ?: 'food_purchase123';
$DB_NAME = getenv('DB_NAME') ?: 'food_purchase';

$MIGRATIONS_DIR = __DIR__ . '/../migrations';

// ============== 连接数据库 ==============
$db = @new mysqli($DB_HOST, $DB_USER, $DB_PASS, $DB_NAME);
if ($db->connect_errno) {
    fwrite(STDERR, "❌ 数据库连接失败: " . $db->connect_error . "\n");
    exit(1);
}
$db->set_charset('utf8mb4');
echo "✅ 已连接数据库 {$DB_USER}@{$DB_HOST}/{$DB_NAME}\n\n";

// ============== 收集迁移文件 ==============
$filter = isset($argv[1]) ? $argv[1] : '';
$allFiles = glob($MIGRATIONS_DIR . '/0*.sql');
sort($allFiles);
$files = [];
foreach ($allFiles as $f) {
    $base = basename($f);
    if ($filter === '' || strpos($base, $filter) !== false) {
        $files[] = $f;
    }
}
if (empty($files)) {
    echo "⚠️  没有匹配的迁移文件\n";
    exit(0);
}

// ============== SQL 分割函数（正确处理字符串字面量与注释） ==============
/**
 * 把一个 SQL 脚本按语句分割。
 * 规则：
 *   - 字符串字面量 'xxx' 内的分号不算分隔符
 *   - 反引号 `xxx` 内的分号不算分隔符
 *   - 双引号 "xxx" 内的分号不算分隔符（ansi_quotes 模式）
 *   -- 行注释 和 /* 块注释 * / 内的分号不算分隔符
 *   - 只有位于"语句上下文"的分号（行尾或后跟空白）才作为分隔符
 */
function splitSqlStatements($sql) {
    $statements = [];
    $len = strlen($sql);
    $buf = '';
    $i = 0;
    $inSingle = false;   // '
    $inDouble = false;   // "
    $inBacktick = false; // `
    $inLineComment = false;
    $inBlockComment = false;

    while ($i < $len) {
        $ch = $sql[$i];
        $next = ($i + 1 < $len) ? $sql[$i + 1] : '';
        $prev = ($i > 0) ? $sql[$i - 1] : '';

        // 行注释 --
        if (!$inSingle && !$inDouble && !$inBacktick && !$inBlockComment
            && $ch === '-' && $next === '-' && ($i === 0 || preg_match('/\s/', $prev))) {
            $inLineComment = true;
        }
        if ($inLineComment) {
            $buf .= $ch;
            if ($ch === "\n") {
                $inLineComment = false;
            }
            $i++;
            continue;
        }
        // 块注释 /* */
        if (!$inSingle && !$inDouble && !$inBacktick && !$inLineComment
            && $ch === '/' && $next === '*') {
            $inBlockComment = true;
            $buf .= '/*';
            $i += 2;
            continue;
        }
        if ($inBlockComment) {
            if ($ch === '*' && $next === '/') {
                $buf .= '*/';
                $i += 2;
                $inBlockComment = false;
                continue;
            }
            $buf .= $ch;
            $i++;
            continue;
        }
        // 字符串/标识符引号切换
        if (!$inDouble && !$inBacktick && $ch === "'" && $prev !== '\\') {
            $inSingle = !$inSingle;
        } elseif (!$inSingle && !$inBacktick && $ch === '"' && $prev !== '\\') {
            $inDouble = !$inDouble;
        } elseif (!$inSingle && !$inDouble && $ch === '`') {
            $inBacktick = !$inBacktick;
        }
        // 分号分隔（仅当不在任何引号/注释内）
        if ($ch === ';' && !$inSingle && !$inDouble && !$inBacktick && !$inLineComment && !$inBlockComment) {
            $stmt = trim($buf);
            if ($stmt !== '') {
                $statements[] = $stmt;
            }
            $buf = '';
            $i++;
            continue;
        }
        $buf .= $ch;
        $i++;
    }
    $tail = trim($buf);
    if ($tail !== '') {
        $statements[] = $tail;
    }
    return $statements;
}

// ============== 逐文件、逐语句执行 ==============
$totalFiles = count($files);
$totalOk = 0;
$totalErr = 0;
$idx = 0;

foreach ($files as $file) {
    $idx++;
    $base = basename($file);
    echo "──── [{$idx}/{$totalFiles}] {$base} ────\n";
    $content = file_get_contents($file);
    if ($content === false) {
        echo "  ❌ 读取文件失败\n";
        $totalErr++;
        continue;
    }
    $statements = splitSqlStatements($content);
    $fileOk = 0;
    $fileErr = 0;
    foreach ($statements as $k => $stmt) {
        // 跳过纯注释/空语句
        $compact = preg_replace('/\s+/', ' ', $stmt);
        if ($compact === '' || strpos($compact, '--') === 0) {
            continue;
        }
        $preview = mb_substr($compact, 0, 70);
        $db->query($stmt);
        if ($db->errno) {
            // 常见幂等错误：字段已存在(1060) / 数据已存在(1062) / 字段或键不存在(1091)
            if (in_array($db->errno, [1060, 1062, 1091], true)) {
                echo "  ⚠️  [{$k}] 幂等跳过 errno={$db->errno} {$db->error} | {$preview}\n";
            } else {
                echo "  ❌ [{$k}] errno={$db->errno} {$db->error} | {$preview}\n";
            }
            $fileErr++;
            $totalErr++;
        } else {
            $aff = $db->affected_rows;
            echo "  ✅ [{$k}] OK affected={$aff} | {$preview}\n";
            $fileOk++;
            $totalOk++;
        }
    }
    echo "  → {$base} 完成：成功 {$fileOk} 条，错误 {$fileErr} 条\n\n";
}

echo "========================================\n";
echo "🎉 全部迁移执行完毕\n";
echo "   文件数：{$totalFiles}\n";
echo "   语句成功：{$totalOk}\n";
echo "   语句错误：{$totalErr}\n";
echo "========================================\n";
$db->close();
exit($totalErr > 0 ? 2 : 0);
