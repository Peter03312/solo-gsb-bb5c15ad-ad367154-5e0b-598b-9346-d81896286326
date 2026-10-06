"""SQLite 连接管理、建表与初始账号。"""
import os
import sqlite3

from . import config, security

SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('author', 'reviewer')),
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    author_id   INTEGER NOT NULL REFERENCES users(id),
    head_version_id INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 版本一经创建正文不可变（应用层不提供任何修改 content 的路径）。
CREATE TABLE IF NOT EXISTS versions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id  INTEGER NOT NULL REFERENCES documents(id),
    version_no   INTEGER NOT NULL,
    content      TEXT NOT NULL,
    content_len  INTEGER NOT NULL,          -- 码位长度，供前端校验选区
    created_by   INTEGER NOT NULL REFERENCES users(id),
    state_rev    INTEGER NOT NULL DEFAULT 1, -- 裁决状态版本号（乐观锁）
    published_at TEXT,                      -- 该版本被发布的时间，NULL 未发布
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (document_id, version_no)
);

CREATE TABLE IF NOT EXISTS proposals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id  INTEGER NOT NULL REFERENCES versions(id),
    start_cp    INTEGER NOT NULL,
    end_cp      INTEGER NOT NULL,
    reason      TEXT NOT NULL DEFAULT '',
    proposer_id INTEGER NOT NULL REFERENCES users(id),
    -- pending 未裁决；accepted / rejected 由另一审阅人裁决
    status      TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'rejected')),
    adjudicator_id INTEGER REFERENCES users(id),
    decided_at  TEXT,
    withdrawn_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_proposals_version ON proposals(version_id);

-- 审阅人对某版本最终预览（含掩码哈希）的确认。
CREATE TABLE IF NOT EXISTS confirmations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id   INTEGER NOT NULL REFERENCES versions(id),
    reviewer_id  INTEGER NOT NULL REFERENCES users(id),
    preview_sha  TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (version_id, reviewer_id)
);

CREATE TABLE IF NOT EXISTS publications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id   INTEGER NOT NULL UNIQUE REFERENCES versions(id),
    document_id  INTEGER NOT NULL REFERENCES documents(id),
    masked_text  TEXT NOT NULL,
    published_by INTEGER NOT NULL REFERENCES users(id),
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    -- 撤稿分两步：作者发起（写入 requested_*），另一名非作者审阅人确认后写入 confirmed_*。
    retraction_reason        TEXT,
    retraction_requested_by  INTEGER REFERENCES users(id),
    retraction_requested_at  TEXT,
    retraction_confirmed_by  INTEGER REFERENCES users(id),
    retraction_confirmed_at  TEXT
);

-- 审阅人打开撤稿记录当时脱敏快照的审计痕迹；确认前必须先查看。
CREATE TABLE IF NOT EXISTS publication_snapshot_views (
    publication_id INTEGER NOT NULL REFERENCES publications(id),
    reviewer_id    INTEGER NOT NULL REFERENCES users(id),
    viewed_at      TEXT NOT NULL DEFAULT (datetime('now')),
    -- 标记这次查看对应的撤稿请求，避免请求前查看（即使时间同秒）被算作确认前查看。
    retraction_requested_at TEXT,
    PRIMARY KEY (publication_id, reviewer_id)
);
"""


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    """为已有 SQLite 数据库补列；新库的 SCHEMA 已包含该列时跳过。"""
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def connect() -> sqlite3.Connection:
    # check_same_thread=False：连接为“每请求一个”，FastAPI 的同步 yield 依赖
    # 建立与清理可能发生在不同线程池线程；并发安全由每请求独立连接 +
    # WAL + BEGIN IMMEDIATE 保证。
    conn = sqlite3.connect(config.DB_PATH, timeout=15, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=15000")
    # 读自动提交；写操作显式 BEGIN IMMEDIATE，保证原子与并发可预期。
    conn.isolation_level = None
    return conn


def init_db() -> None:
    os.makedirs(os.path.dirname(config.DB_PATH), exist_ok=True)
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        _ensure_column(conn, "publications", "retraction_reason", "retraction_reason TEXT")
        _ensure_column(
            conn, "publications", "retraction_requested_by",
            "retraction_requested_by INTEGER REFERENCES users(id)",
        )
        _ensure_column(conn, "publications", "retraction_requested_at", "retraction_requested_at TEXT")
        _ensure_column(
            conn, "publications", "retraction_confirmed_by",
            "retraction_confirmed_by INTEGER REFERENCES users(id)",
        )
        _ensure_column(conn, "publications", "retraction_confirmed_at", "retraction_confirmed_at TEXT")
        _ensure_column(
            conn,
            "publication_snapshot_views",
            "retraction_requested_at",
            "retraction_requested_at TEXT",
        )
        if conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"] == 0:
            seeds = [
                (config.SEED_AUTHOR_USER, "作者", "author", config.SEED_AUTHOR_PASS),
                (config.SEED_REVIEWER1_USER, "审阅人一", "reviewer", config.SEED_REVIEWER1_PASS),
                (config.SEED_REVIEWER2_USER, "审阅人二", "reviewer", config.SEED_REVIEWER2_PASS),
            ]
            for username, display, role, password in seeds:
                if username:
                    conn.execute(
                        "INSERT INTO users (username, display_name, role, password_hash)"
                        " VALUES (?, ?, ?, ?)",
                        (username, display, role, security.hash_password(password)),
                    )
    finally:
        conn.close()
