SET search_path TO woocms, public;

-- 清理其他项目残留的 B2B 外贸询盘系统（前台会员页 + 销售归因 + 询盘 CRM + 会员价/阶梯价分级定价）。
-- dev 站零业务数据（0 询盘 / 0 客户 / 0 会员）；表与字段均无数据支撑，安全删除。
-- customer 角色（迁移 000049 引入）保留，供新前台用户认证 API 复用。
DROP TABLE IF EXISTS cms_inquiries CASCADE;
DROP TABLE IF EXISTS cms_customers CASCADE;
DROP TABLE IF EXISTS cms_sales_profiles CASCADE;

-- 删除会员价 / 阶梯价相关字段定义（迁移 000049 向 products-import-fields 组插入）。
DELETE FROM cms_field_defs WHERE name IN ('price-unit', 'tier-pricing');
