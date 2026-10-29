SET search_path TO woocms, public;

-- 部署环境曾出现该表 reloptions 被显式设为 autovacuum_enabled=false(非本项目任何迁移/脚本所设，
-- 推测源自建库工具/备份恢复流程的默认值)；百万行级 CPT 常规批量 UPDATE/DELETE(去重、字段回填、
-- 翻译回填等)下死元组只进不出，实测死元组比活元组还多(113%)，曾导致列表页 SSR 从秒级退化到
-- 分钟级。这里显式重新开启，并对大表适当收紧阈值(默认 20% 死元组才触发一次 autovacuum，百万行
-- 规模下太迟)，防止该配置在任何环境(含从旧备份恢复的库)再次生效——即使运维再次手动改回，
-- 下次启动也不会自动被本迁移覆盖(迁移只跑一次)，但至少保证全新安装与本次升级都是开启状态。
-- meta_json(JSONB)是本表主要的 TOAST 膨胀来源，一并显式打开对应 TOAST 表的 autovacuum。
ALTER TABLE cms_content_entries SET (
    autovacuum_enabled = true,
    toast.autovacuum_enabled = true,
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.05
);
