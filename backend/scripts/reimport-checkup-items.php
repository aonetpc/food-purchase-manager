<?php
/**
 * reimport-checkup-items.php — 体检项目手动重导脚本（专门兜底 070）
 *
 * 背景：
 *   - migrate.js 因迁移ID冲突（070 同时被两个文件占用）会跳过本文件
 *   - `mysql < 070.sql` 默认遇到 ALTER 失败就停，导致 DELETE/INSERT 不执行
 *   - 此脚本绕过以上两个问题，专门保证体检项目能被全量重导
 *
 * 做什么：
 *   1. 打印导入前的项目数量统计（按 category / item_type）
 *   2. 逐条执行 070_checkup_items_import_mysql57.sql
 *   3. 打印导入后的项目数量统计 + 编码示例
 *
 * 幂等：可重复执行（DELETE 后重新 INSERT；ALTER 失败会跳过）
 *
 * 用法：
 *   php reimport-checkup-items.php
 */

$DB_HOST = getenv('DB_HOST') ?: 'localhost';
$DB_USER = getenv('DB_USER') ?: 'food_purchase';
$DB_PASS = getenv('DB_PASSWORD') ?: 'food_purchase123';
$DB_NAME = getenv('DB_NAME') ?: 'food_purchase';

$SQL_FILE = __DIR__ . '/../migrations/070_checkup_items_import_mysql57.sql';

// ============== 连接 ==============
$db = @new mysqli($DB_HOST, $DB_USER, $DB_PASS, $DB_NAME);
if ($db->connect_errno) {
    fwrite(STDERR, "❌ 数据库连接失败: " . $db->connect_error . "\n");
    exit(1);
}
$db->set_charset('utf8mb4');
echo "✅ 已连接数据库 {$DB_USER}@{$DB_HOST}/{$DB_NAME}\n";
if (!file_exists($SQL_FILE)) {
    fwrite(STDERR, "❌ 找不到 SQL 文件: {$SQL_FILE}\n");
    exit(1);
}
echo "📄 SQL 文件: {$SQL_FILE}\n\n";

// ============== 统计辅助 ==============
function showStats($db, $label) {
    echo "===== {$label} =====\n";
    $res = $db->query("SELECT COUNT(*) AS c FROM booking_checkup_items");
    $total = $res ? (int)$res->fetch_assoc()['c'] : -1;
    echo "  booking_checkup_items 总数: {$total}\n";
    if ($total >= 0) {
        $res = $db->query("SELECT category, item_type, COUNT(*) AS c
                           FROM booking_checkup_items
                           GROUP BY category, item_type
                           ORDER BY FIELD(category,'化验','专科','功能检查','影像'), item_type");
        if ($res) {
            while ($row = $res->fetch_assoc()) {
                echo "    - [{$row['category']}] {$row['item_type']}: {$row['c']}\n";
            }
        }
    }
    $res = $db->query("SELECT COUNT(*) AS c FROM booking_item_sub_items");
    $sub = $res ? (int)$res->fetch_assoc()['c'] : -1;
    echo "  booking_item_sub_items 总数: {$sub}\n";
    echo "\n";
}

// ============== SQL 分割（与 run-migrations.php 同实现） ==============
function splitSqlStatements($sql) {
    $statements = [];
    $len = strlen($sql);
    $buf = '';
    $i = 0;
    $inSingle = false; $inDouble = false; $inBacktick = false;
    $inLineComment = false; $inBlockComment = false;
    while ($i < $len) {
        $ch = $sql[$i];
        $next = ($i + 1 < $len) ? $sql[$i + 1] : '';
        $prev = ($i > 0) ? $sql[$i - 1] : '';
        if (!$inSingle && !$inDouble && !$inBacktick && !$inBlockComment
            && $ch === '-' && $next === '-' && ($i === 0 || preg_match('/\s/', $prev))) {
            $inLineComment = true;
        }
        if ($inLineComment) {
            $buf .= $ch;
            if ($ch === "\n") { $inLineComment = false; }
            $i++; continue;
        }
        if (!$inSingle && !$inDouble && !$inBacktick && !$inLineComment
            && $ch === '/' && $next === '*') {
            $inBlockComment = true; $buf .= '/*'; $i += 2; continue;
        }
        if ($inBlockComment) {
            if ($ch === '*' && $next === '/') { $buf .= '*/'; $i += 2; $inBlockComment = false; continue; }
            $buf .= $ch; $i++; continue;
        }
        if (!$inDouble && !$inBacktick && $ch === "'" && $prev !== '\\') $inSingle = !$inSingle;
        elseif (!$inSingle && !$inBacktick && $ch === '"' && $prev !== '\\') $inDouble = !$inDouble;
        elseif (!$inSingle && !$inDouble && $ch === '`') $inBacktick = !$inBacktick;
        if ($ch === ';' && !$inSingle && !$inDouble && !$inBacktick && !$inLineComment && !$inBlockComment) {
            $stmt = trim($buf);
            if ($stmt !== '') $statements[] = $stmt;
            $buf = ''; $i++; continue;
        }
        $buf .= $ch; $i++;
    }
    $tail = trim($buf);
    if ($tail !== '') $statements[] = $tail;
    return $statements;
}

// ============== 主流程 ==============
showStats($db, '导入前');

echo "──── 开始逐条执行 070_checkup_items_import_mysql57.sql ────\n";
$content = file_get_contents($SQL_FILE);
$statements = splitSqlStatements($content);
echo "解析出 " . count($statements) . " 条语句\n\n";

$ok = 0; $err = 0; $skipped = 0;
foreach ($statements as $k => $stmt) {
    $compact = preg_replace('/\s+/', ' ', $stmt);
    $preview = mb_substr($compact, 0, 60);
    $db->query($stmt);
    if ($db->errno) {
        if (in_array($db->errno, [1060, 1062, 1091], true)) {
            echo "  ⚠️  [{$k}] 幂等跳过 errno={$db->errno} | {$preview}\n";
            $skipped++;
        } else {
            echo "  ❌ [{$k}] errno={$db->errno} {$db->error} | {$preview}\n";
            $err++;
        }
    } else {
        $aff = $db->affected_rows;
        echo "  ✅ [{$k}] affected={$aff} | {$preview}\n";
        $ok++;
    }
}
echo "\n→ 执行完毕：成功 {$ok}，幂等跳过 {$skipped}，错误 {$err}\n\n";

showStats($db, '导入后');

// 编码示例
$res = $db->query("SELECT code, name, category, item_type, default_price, insurance_price
                   FROM booking_checkup_items
                   ORDER BY code LIMIT 10");
if ($res && $res->num_rows > 0) {
    echo "===== 编码示例（前10条） =====\n";
    while ($row = $res->fetch_assoc()) {
        echo "  {$row['code']} | {$row['name']} | {$row['category']}/{$row['item_type']} | ¥{$row['default_price']} / 医保¥{$row['insurance_price']}\n";
    }
    echo "\n";
}

echo "========================================\n";
if ($err > 0) {
    echo "⚠️  存在 {$err} 条错误，请检查上方日志\n";
    exit(2);
} else {
    echo "🎉 体检项目重导完成（无致命错误）\n";
    exit(0);
}
$db->close();
