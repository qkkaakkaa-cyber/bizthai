-- 000110: 站点新增「源语言」source_locale，与「默认展示语言」default_locale 解耦。
--
-- 背景：原设计把 default_locale 同时当作「源表用哪种语言写」和「不指定时默认展示哪种语言」，
-- 二者被绑死，导致「源表是 A 语言、却想默认展示 B 语言（B 在翻译旁表有译文）」无法实现
-- （i18nLocaleChain 把 default_locale 剔出翻译链直读源表，B 的译文永不被前台读取）。
--
-- 解耦后：source_locale = 源表语言（直读源表、剔出翻译链、AI 翻译的源）；
--        default_locale = 默认展示语言（裸请求/无前缀时解析到的语言，可走翻译旁表）。
-- 既有站点 source_locale 回填 = default_locale，行为完全不变（向后兼容）。

ALTER TABLE cms_sites ADD COLUMN IF NOT EXISTS source_locale VARCHAR(16) NOT NULL DEFAULT '';

UPDATE cms_sites SET source_locale = default_locale WHERE source_locale = '';
