"""每日补翻编排(供 dbdadmin-translate.service 调用)。

具体翻译、队列消费、term 落库、存量回填都收敛到 i18n_worker.py。
这样导入进程只投递缺译任务,不会被翻译 API 或大批量回填影响。
"""
import i18n_worker


def main():
    i18n_worker.run(include_db_scan=True, backfill=True)


if __name__ == "__main__":
    main()
