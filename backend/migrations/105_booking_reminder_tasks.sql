-- 新建 booking_reminder_tasks 表
-- 用于交互卡片催办 & 过期兜底。企微 response_code 仅 72h 有效，
-- 催办间隔 60h，每次催办：① 灰化上一张卡为"已催办N次"；② 发新卡(新 response_code)。

CREATE TABLE IF NOT EXISTS booking_reminder_tasks (
  id                  VARCHAR(36)  NOT NULL COMMENT 'UUID',
  order_id            VARCHAR(36)  NOT NULL COMMENT '关联订单 ID',
  stage               VARCHAR(20)  NOT NULL COMMENT '催办阶段: reviewing(审批中) / sales_confirming(销售确认中)',
  userid              VARCHAR(100) NOT NULL COMMENT '待催办的企微 userid(审核员或销售员)',
  remind_count        INT          NOT NULL DEFAULT 0 COMMENT '已催办次数，0=首次发卡后未催办过',
  max_remind          INT          NOT NULL DEFAULT 3 COMMENT '最大催办次数(默认3次)',
  next_remind_at      DATETIME     NOT NULL COMMENT '下次催办的时间',
  status              VARCHAR(20)  NOT NULL DEFAULT 'pending' COMMENT 'pending / completed / cancelled',
  last_response_code  VARCHAR(100) NULL COMMENT '最新一张交互卡的 response_code',
  last_response_at    DATETIME     NULL COMMENT '最新一张交互卡的发送时间',
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_next (status, next_remind_at),
  INDEX idx_order (order_id),
  INDEX idx_userid_stage (userid, stage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='预订交互卡催办任务';
