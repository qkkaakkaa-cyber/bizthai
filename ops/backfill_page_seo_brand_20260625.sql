SET search_path TO woocms, public;

BEGIN;

CREATE TABLE IF NOT EXISTS page_seo_backup_20260625_brand AS
SELECT now() AS backed_up_at, *
FROM cms_page_seo
WHERE site_id = 1;

CREATE TABLE IF NOT EXISTS page_translations_backup_20260625_brand AS
SELECT now() AS backed_up_at, *
FROM cms_page_translations
WHERE site_id = 1;

CREATE TEMP TABLE tmp_page_seo_brand_i18n (
    page_id BIGINT NOT NULL,
    locale VARCHAR(16) NOT NULL,
    page_title VARCHAR(255) NOT NULL,
    page_summary TEXT NOT NULL,
    seo_title VARCHAR(255) NOT NULL,
    seo_keywords VARCHAR(512) NOT NULL,
    seo_description VARCHAR(512) NOT NULL,
    PRIMARY KEY (page_id, locale)
) ON COMMIT DROP;

INSERT INTO tmp_page_seo_brand_i18n (page_id, locale, page_title, page_summary, seo_title, seo_keywords, seo_description) VALUES
(1, 'en', 'Business Reports', 'BizThai business intelligence reports for Thai company search, regional ranking, industry and investment research.',
 'BizThai - Thai Company Search_Business Reports_Company Intelligence Platform',
 'BizThai, BizThai.com, Thai company search, business reports Thailand, company intelligence, Thailand business lookup',
 'BizThai.com is a Thai company intelligence platform for company search, business reports, regional rankings, industry analysis and investment research.'),
(1, 'th', 'รายงานธุรกิจไทย', 'รายงานข้อมูลธุรกิจของ BizThai สำหรับค้นหาบริษัทไทย จัดอันดับภูมิภาค วิเคราะห์อุตสาหกรรมและการลงทุน',
 'BizThai - ค้นหาบริษัทไทย_รายงานธุรกิจ_แพลตฟอร์มข้อมูลบริษัท',
 'BizThai, BizThai.com, ค้นหาบริษัทไทย, รายงานธุรกิจไทย, ข้อมูลบริษัทไทย, วิเคราะห์ธุรกิจไทย',
 'BizThai.com คือแพลตฟอร์มข้อมูลบริษัทไทยสำหรับค้นหาบริษัท ดูรายงานธุรกิจ อันดับจังหวัด วิเคราะห์อุตสาหกรรมและโอกาสการลงทุน'),
(1, 'zh-CN', '泰国商业报告', 'BizThai 商业情报报告，面向泰国企业查询、区域排名、行业和投资研究。',
 'BizThai - 泰国企业查询_商业报告_企业信息查询平台',
 'BizThai, BizThai.com, 泰国企业查询, 泰国商业报告, 泰国企业信息, 泰国商业情报',
 'BizThai.com 是泰国企业信息查询平台，提供公司查询、商业报告、区域排名、行业分析和投资研究入口。'),

(2, 'en', 'Company Lookup', 'Search Thai companies by name, registration number, province, industry and business activity on BizThai.',
 'Thai Company Lookup_Company Search_Business Registry | BizThai',
 'BizThai, BizThai.com, Thai company lookup, company search Thailand, business registry, Thai company information',
 'Search Thai companies on BizThai.com by name, registration number, province or industry, and quickly review company profiles, capital and business activity.'),
(2, 'th', 'ค้นหาบริษัทไทย', 'ค้นหาบริษัทไทยด้วยชื่อ เลขทะเบียน จังหวัด อุตสาหกรรม และกิจกรรมทางธุรกิจบน BizThai',
 'ค้นหาบริษัทไทย_ตรวจสอบข้อมูลบริษัท_ทะเบียนธุรกิจ | BizThai',
 'BizThai, BizThai.com, ค้นหาบริษัทไทย, ตรวจสอบบริษัทไทย, ข้อมูลนิติบุคคลไทย, ทะเบียนธุรกิจไทย',
 'ค้นหาบริษัทไทยบน BizThai.com ด้วยชื่อ เลขทะเบียน จังหวัด หรืออุตสาหกรรม พร้อมดูโปรไฟล์บริษัท ทุน และกิจกรรมทางธุรกิจได้รวดเร็ว'),
(2, 'zh-CN', '泰国企业查询', '在 BizThai 按公司名、注册号、省府、行业和经营活动查询泰国企业。',
 '泰国企业查询_公司查询_企业信息查询 | BizThai',
 'BizThai, BizThai.com, 泰国企业查询, 泰国公司查询, 泰国企业信息, 泰国商业注册查询',
 '在 BizThai.com 按名称、注册号、省府或行业查询泰国公司，快速查看公司档案、注册资本和经营活动。'),

(3, 'en', 'Regional Ranking', 'Compare Thai provinces by company count, capital and business concentration on BizThai.',
 'Thai Province Company Ranking_Regional Business Data | BizThai',
 'BizThai, BizThai.com, Thai province ranking, regional business data, company count Thailand, province company search',
 'Use BizThai.com to compare Thai provinces by company count, capital and business concentration, then open regional company data for deeper research.'),
(3, 'th', 'อันดับบริษัทตามจังหวัด', 'เปรียบเทียบจังหวัดไทยตามจำนวนบริษัท ทุน และความหนาแน่นทางธุรกิจบน BizThai',
 'จัดอันดับบริษัทตามจังหวัด_ข้อมูลธุรกิจภูมิภาค | BizThai',
 'BizThai, BizThai.com, อันดับบริษัทไทย, บริษัทตามจังหวัด, ข้อมูลธุรกิจภูมิภาค, จำนวนบริษัทไทย',
 'ใช้ BizThai.com เปรียบเทียบจังหวัดไทยตามจำนวนบริษัท ทุน และความหนาแน่นทางธุรกิจ แล้วเปิดดูข้อมูลบริษัทในแต่ละพื้นที่'),
(3, 'zh-CN', '泰国区域企业排名', '在 BizThai 按企业数量、资本和商业集中度比较泰国各府。',
 '泰国府级企业排名_区域商业数据 | BizThai',
 'BizThai, BizThai.com, 泰国区域排名, 泰国各府企业, 区域商业数据, 泰国公司数量',
 '用 BizThai.com 比较泰国各府的企业数量、资本规模和商业集中度，并进入区域企业数据做进一步研究。'),

(4, 'en', 'Foreign Capital', 'Explore foreign-capital and investor-origin signals in Thai company records on BizThai.',
 'Foreign Capital Companies in Thailand_Investor Search | BizThai',
 'BizThai, BizThai.com, foreign capital Thailand, foreign companies Thailand, investor origin, Thai company shareholders',
 'Explore foreign-capital companies in Thailand on BizThai.com, including investor-origin signals, shareholder clues and company profile links.'),
(4, 'th', 'ทุนต่างชาติ', 'สำรวจบริษัทไทยที่เกี่ยวข้องกับทุนต่างชาติ แหล่งทุน และสัญญาณผู้ลงทุนบน BizThai',
 'บริษัททุนต่างชาติในไทย_ค้นหานักลงทุน | BizThai',
 'BizThai, BizThai.com, บริษัททุนต่างชาติ, ทุนต่างชาติไทย, ผู้ถือหุ้นบริษัทไทย, นักลงทุนต่างชาติในไทย',
 'สำรวจบริษัททุนต่างชาติในไทยบน BizThai.com พร้อมสัญญาณประเทศผู้ลงทุน เบาะแสผู้ถือหุ้น และลิงก์โปรไฟล์บริษัท'),
(4, 'zh-CN', '泰国外资企业', '在 BizThai 查看泰国企业中的外资、投资来源和股东线索。',
 '泰国外资企业查询_投资来源搜索 | BizThai',
 'BizThai, BizThai.com, 泰国外资企业, 泰国外资公司, 投资来源, 泰国公司股东',
 '在 BizThai.com 查询泰国外资企业，查看投资来源、股东线索和相关公司档案入口。'),

(5, 'en', 'New Registrations', 'Track newly registered Thai companies by date, province and industry on BizThai.',
 'New Thai Companies_Recent Registrations_Company Search | BizThai',
 'BizThai, BizThai.com, new Thai companies, recent company registrations, Thailand startups, new business search',
 'Track newly registered Thai companies on BizThai.com by date, province and industry, and find fresh business leads from recent company records.'),
(5, 'th', 'บริษัทจดทะเบียนใหม่', 'ติดตามบริษัทไทยจดทะเบียนใหม่ตามวันที่ จังหวัด และอุตสาหกรรมบน BizThai',
 'บริษัทไทยจดทะเบียนใหม่_ค้นหาบริษัทใหม่ | BizThai',
 'BizThai, BizThai.com, บริษัทใหม่ไทย, บริษัทจดทะเบียนใหม่, ค้นหาธุรกิจใหม่, บริษัทเปิดใหม่',
 'ติดตามบริษัทไทยจดทะเบียนใหม่บน BizThai.com ตามวันที่ จังหวัด และอุตสาหกรรม เพื่อค้นหาโอกาสธุรกิจและคู่ค้าใหม่'),
(5, 'zh-CN', '泰国新注册公司', '在 BizThai 按日期、省府和行业跟踪泰国新注册公司。',
 '泰国新注册公司_新公司查询 | BizThai',
 'BizThai, BizThai.com, 泰国新公司, 泰国新注册公司, 新企业查询, 泰国创业公司',
 '在 BizThai.com 按日期、省府和行业跟踪泰国新注册公司，发现新的商业机会和潜在合作伙伴。'),

(6, 'en', 'Industry Investment Overview', 'Compare Thai industries by company count, capital and business activity on BizThai.',
 'Thai Industry Analysis_Business Sector Search | BizThai',
 'BizThai, BizThai.com, Thai industry analysis, business sector Thailand, industry company search, market research Thailand',
 'Use BizThai.com to compare Thai industries by company count, capital and business activity for market research and investment screening.'),
(6, 'th', 'ภาพรวมอุตสาหกรรมไทย', 'เปรียบเทียบอุตสาหกรรมไทยตามจำนวนบริษัท ทุน และกิจกรรมทางธุรกิจบน BizThai',
 'วิเคราะห์อุตสาหกรรมไทย_ค้นหาธุรกิจตามหมวด | BizThai',
 'BizThai, BizThai.com, วิเคราะห์อุตสาหกรรมไทย, หมวดธุรกิจไทย, ค้นหาบริษัทตามอุตสาหกรรม, วิจัยตลาดไทย',
 'ใช้ BizThai.com เปรียบเทียบอุตสาหกรรมไทยตามจำนวนบริษัท ทุน และกิจกรรมทางธุรกิจ เพื่อวิจัยตลาดและคัดกรองโอกาสลงทุน'),
(6, 'zh-CN', '泰国行业投资概览', '在 BizThai 按企业数量、资本和商业活动比较泰国行业。',
 '泰国行业分析_按行业查询公司 | BizThai',
 'BizThai, BizThai.com, 泰国行业分析, 泰国商业行业, 行业公司查询, 泰国市场研究',
 '用 BizThai.com 按企业数量、资本规模和商业活跃度比较泰国行业，用于市场研究和投资筛选。'),

(7, 'en', 'Regional Investment Map', 'Browse Thai provinces as market-entry paths and regional business opportunities on BizThai.',
 'Thailand Regional Investment Map_Province Company Search | BizThai',
 'BizThai, BizThai.com, Thailand investment map, province company data, Thai market entry, regional opportunities',
 'Browse Thai provinces on BizThai.com as market-entry paths and connect regional company data with industry, capital and opportunity signals.'),
(7, 'th', 'แผนที่การลงทุนรายภูมิภาค', 'สำรวจจังหวัดไทยในฐานะเส้นทางเข้าสู่ตลาดและโอกาสธุรกิจบน BizThai',
 'แผนที่การลงทุนไทย_ค้นหาบริษัทตามจังหวัด | BizThai',
 'BizThai, BizThai.com, แผนที่การลงทุนไทย, ข้อมูลบริษัทตามจังหวัด, เข้าตลาดไทย, โอกาสธุรกิจภูมิภาค',
 'สำรวจจังหวัดไทยบน BizThai.com ในฐานะเส้นทางเข้าสู่ตลาด และเชื่อมข้อมูลบริษัทในพื้นที่กับอุตสาหกรรม ทุน และโอกาสธุรกิจ'),
(7, 'zh-CN', '泰国区域投资地图', '在 BizThai 以泰国各府为入口研究市场进入和区域机会。',
 '泰国区域投资地图_按府查询公司 | BizThai',
 'BizThai, BizThai.com, 泰国投资地图, 各府企业数据, 泰国市场进入, 区域商业机会',
 '在 BizThai.com 浏览泰国各府作为市场进入路径，把区域企业数据与行业、资本和机会信号连接起来。'),

(8, 'en', 'Owner And Shareholder Leads', 'Start owner, director and shareholder checks from Thai company profiles on BizThai.',
 'Thai Company Owner Search_Director & Shareholder Leads | BizThai',
 'BizThai, BizThai.com, Thai company owner search, director search Thailand, shareholder leads, business due diligence',
 'Use BizThai.com to start Thai company owner, director and shareholder research from company profiles, capital, province and business activity clues.'),
(8, 'th', 'ข้อมูลเจ้าของและผู้ถือหุ้น', 'เริ่มตรวจสอบเจ้าของ กรรมการ และผู้ถือหุ้นจากโปรไฟล์บริษัทไทยบน BizThai',
 'ค้นหาเจ้าของบริษัทไทย_กรรมการและผู้ถือหุ้น | BizThai',
 'BizThai, BizThai.com, ค้นหาเจ้าของบริษัทไทย, กรรมการบริษัทไทย, ผู้ถือหุ้นบริษัทไทย, ตรวจสอบคู่ค้า',
 'ใช้ BizThai.com เริ่มค้นหาเจ้าของ กรรมการ และผู้ถือหุ้นบริษัทไทยจากโปรไฟล์บริษัท ทุน จังหวัด และกิจกรรมทางธุรกิจ'),
(8, 'zh-CN', '泰国企业所有人与股东线索', '从 BizThai 公司档案出发，核查泰国企业所有人、董事和股东线索。',
 '泰国公司老板查询_董事股东线索 | BizThai',
 'BizThai, BizThai.com, 泰国公司老板查询, 泰国公司董事, 泰国公司股东, 商业尽调',
 '用 BizThai.com 从公司档案、资本、省府和经营活动线索出发，开展泰国企业所有人、董事和股东研究。'),

(9, 'en', 'Regional Rankings Summary', 'Review province-level business rankings and regional company data summaries on BizThai.',
 'Thailand Regional Ranking Summary_Company Data | BizThai',
 'BizThai, BizThai.com, Thailand regional ranking, province business data, company ranking summary, regional company search',
 'Review Thai regional ranking summaries on BizThai.com, then jump into province company counts, capital data and market concentration.'),
(9, 'th', 'สรุปอันดับธุรกิจรายภูมิภาค', 'ดูสรุปอันดับธุรกิจตามจังหวัดและข้อมูลบริษัทภูมิภาคบน BizThai',
 'สรุปอันดับภูมิภาคไทย_ข้อมูลบริษัทตามจังหวัด | BizThai',
 'BizThai, BizThai.com, สรุปอันดับภูมิภาค, ข้อมูลธุรกิจจังหวัด, อันดับบริษัทไทย, ค้นหาบริษัทภูมิภาค',
 'ดูสรุปอันดับธุรกิจรายภูมิภาคบน BizThai.com แล้วเข้าสู่ข้อมูลจำนวนบริษัท ทุน และความหนาแน่นทางตลาดของแต่ละจังหวัด'),
(9, 'zh-CN', '泰国区域排名摘要', '在 BizThai 快速查看泰国各府商业排名和企业数据摘要。',
 '泰国区域排名摘要_府级企业数据 | BizThai',
 'BizThai, BizThai.com, 泰国区域排名, 各府商业数据, 企业排名摘要, 区域公司查询',
 '在 BizThai.com 查看泰国区域排名摘要，并进入各府企业数量、资本数据和市场集中度分析。'),

(10, 'en', 'All Thai Companies', 'Search and filter Thai companies by name, number, province, industry and activity on BizThai.',
 'BizThai - Thai Company Directory_Company Search_Company Lookup',
 'BizThai, BizThai.com, Thai company directory, company search Thailand, Thai company lookup, Thailand company information',
 'BizThai.com helps you search and filter Thai companies by name, number, province and industry, with company profiles for partner search and due diligence.'),
(10, 'th', 'ไดเรกทอรีบริษัทไทยทั้งหมด', 'ค้นหาและกรองบริษัทไทยตามชื่อ เลขทะเบียน จังหวัด อุตสาหกรรม และกิจกรรมบน BizThai',
 'BizThai - ไดเรกทอรีบริษัทไทย_ค้นหาบริษัท_ตรวจสอบบริษัท',
 'BizThai, BizThai.com, ไดเรกทอรีบริษัทไทย, ค้นหาบริษัทไทย, ตรวจสอบบริษัทไทย, ข้อมูลบริษัทไทย',
 'BizThai.com ช่วยค้นหาและกรองบริษัทไทยตามชื่อ เลขทะเบียน จังหวัด และอุตสาหกรรม พร้อมโปรไฟล์บริษัทสำหรับหาคู่ค้าและตรวจสอบข้อมูล'),
(10, 'zh-CN', '全部泰国企业', '在 BizThai 按名称、注册号、省府、行业和经营活动搜索筛选泰国公司。',
 'BizThai - 泰国企业名录_公司查询_企业信息查询',
 'BizThai, BizThai.com, 泰国企业名录, 泰国企业查询, 泰国公司查询, 泰国企业信息',
 'BizThai.com 帮你按名称、注册号、省府和行业搜索筛选泰国公司，查看企业档案，用于找客户、找伙伴和商业尽调。'),

(11, 'en', 'Regional Rankings', 'Rank Thai provinces by registered company count, capital and business activity on BizThai.',
 'Thailand Province Company Rankings_Regional Search | BizThai',
 'BizThai, BizThai.com, Thailand province ranking, province company search, regional company data, Thai business ranking',
 'Rank Thai provinces on BizThai.com by company count, capital and activity, then open province pages and company records for regional research.'),
(11, 'th', 'อันดับบริษัทตามจังหวัด', 'จัดอันดับจังหวัดไทยตามจำนวนบริษัท ทุน และกิจกรรมทางธุรกิจบน BizThai',
 'อันดับบริษัทตามจังหวัด_ค้นหาธุรกิจภูมิภาค | BizThai',
 'BizThai, BizThai.com, อันดับจังหวัดไทย, ค้นหาบริษัทตามจังหวัด, ข้อมูลธุรกิจภูมิภาค, อันดับธุรกิจไทย',
 'จัดอันดับจังหวัดไทยบน BizThai.com ตามจำนวนบริษัท ทุน และกิจกรรมทางธุรกิจ แล้วเปิดดูหน้าจังหวัดและโปรไฟล์บริษัท'),
(11, 'zh-CN', '泰国各府企业排名', '在 BizThai 按企业数量、资本和商业活动排名泰国各府。',
 '泰国各府企业排名_区域公司查询 | BizThai',
 'BizThai, BizThai.com, 泰国府排名, 各府公司查询, 区域企业数据, 泰国商业排名',
 '在 BizThai.com 按企业数量、资本和活跃度排名泰国各府，并进入府级页面和公司记录做区域研究。'),

(12, 'en', 'Sign in', 'Sign in to BizThai to manage searches, reports and company research tools.',
 'BizThai Login_Sign In to Thai Company Search',
 'BizThai, BizThai.com, BizThai login, Thai company search login, business intelligence account',
 'Sign in to BizThai.com to save searches, access Thai company lookup tools and manage your business research workspace.'),
(12, 'th', 'เข้าสู่ระบบ', 'เข้าสู่ระบบ BizThai เพื่อจัดการการค้นหา รายงาน และเครื่องมือวิจัยบริษัท',
 'เข้าสู่ระบบ BizThai_บัญชีค้นหาบริษัทไทย',
 'BizThai, BizThai.com, เข้าสู่ระบบ BizThai, บัญชีค้นหาบริษัทไทย, บัญชีข้อมูลธุรกิจ',
 'เข้าสู่ระบบ BizThai.com เพื่อบันทึกการค้นหา ใช้เครื่องมือค้นหาบริษัทไทย และจัดการพื้นที่ทำงานวิจัยธุรกิจ'),
(12, 'zh-CN', '登录', '登录 BizThai，管理搜索、报告和企业研究工具。',
 'BizThai 登录_泰国企业查询账户',
 'BizThai, BizThai.com, BizThai 登录, 泰国企业查询登录, 商业情报账户',
 '登录 BizThai.com，保存搜索、使用泰国企业查询工具并管理你的商业研究工作区。'),

(13, 'en', 'Create account', 'Create a BizThai account for Thai company search, reports and AI tools.',
 'Create BizThai Account_Thai Company Search Platform',
 'BizThai, BizThai.com, register BizThai, BizThai account, Thai company search account',
 'Create a BizThai.com account to use Thai company search, business reports, AI assistance and company research tools.'),
(13, 'th', 'สร้างบัญชี', 'สร้างบัญชี BizThai เพื่อใช้การค้นหาบริษัท รายงาน และเครื่องมือ AI',
 'สมัคร BizThai_บัญชีค้นหาบริษัทไทย',
 'BizThai, BizThai.com, สมัคร BizThai, บัญชี BizThai, บัญชีค้นหาบริษัทไทย',
 'สร้างบัญชี BizThai.com เพื่อใช้ค้นหาบริษัทไทย ดูรายงานธุรกิจ ใช้ผู้ช่วย AI และเครื่องมือวิจัยบริษัท'),
(13, 'zh-CN', '创建账户', '创建 BizThai 账户，使用泰国企业查询、报告和 AI 工具。',
 '注册 BizThai_泰国企业查询平台账户',
 'BizThai, BizThai.com, 注册 BizThai, BizThai 账户, 泰国企业查询账户',
 '创建 BizThai.com 账户，使用泰国企业查询、商业报告、AI 助手和公司研究工具。'),

(14, 'en', 'Reset your password', 'Request a secure password reset for your BizThai account.',
 'Reset BizThai Password_Account Recovery',
 'BizThai, BizThai.com, BizThai password reset, account recovery, Thai company search account',
 'Request a secure password reset for your BizThai.com account and return to Thai company search and business research tools.'),
(14, 'th', 'รีเซ็ตรหัสผ่าน', 'ขอลิงก์รีเซ็ตรหัสผ่านที่ปลอดภัยสำหรับบัญชี BizThai',
 'รีเซ็ตรหัสผ่าน BizThai_กู้คืนบัญชี',
 'BizThai, BizThai.com, รีเซ็ตรหัสผ่าน BizThai, กู้คืนบัญชี, บัญชีค้นหาบริษัทไทย',
 'ขอรีเซ็ตรหัสผ่านที่ปลอดภัยสำหรับบัญชี BizThai.com แล้วกลับไปใช้เครื่องมือค้นหาบริษัทไทยและวิจัยธุรกิจ'),
(14, 'zh-CN', '重置密码', '为你的 BizThai 账户请求安全的密码重置。',
 '重置 BizThai 密码_账户找回',
 'BizThai, BizThai.com, BizThai 密码重置, 账户找回, 泰国企业查询账户',
 '为你的 BizThai.com 账户请求安全的密码重置，继续使用泰国企业查询和商业研究工具。'),

(15, 'en', 'Set a new password', 'Choose a new password for your BizThai account.',
 'Set New BizThai Password_Account Security',
 'BizThai, BizThai.com, set new password, BizThai account security, password recovery',
 'Set a new password for your BizThai.com account and protect access to your company research workspace.'),
(15, 'th', 'ตั้งรหัสผ่านใหม่', 'ตั้งรหัสผ่านใหม่สำหรับบัญชี BizThai ของคุณ',
 'ตั้งรหัสผ่านใหม่ BizThai_ความปลอดภัยบัญชี',
 'BizThai, BizThai.com, ตั้งรหัสผ่านใหม่, ความปลอดภัยบัญชี BizThai, กู้คืนรหัสผ่าน',
 'ตั้งรหัสผ่านใหม่สำหรับบัญชี BizThai.com เพื่อปกป้องการเข้าถึงพื้นที่ทำงานวิจัยบริษัทของคุณ'),
(15, 'zh-CN', '设置新密码', '为你的 BizThai 账户设置新密码。',
 '设置新的 BizThai 密码_账户安全',
 'BizThai, BizThai.com, 设置新密码, BizThai 账户安全, 密码找回',
 '为你的 BizThai.com 账户设置新密码，保护企业研究工作区的访问安全。'),

(16, 'en', 'Member center', 'Manage your BizThai account, profile and company research workspace.',
 'BizThai Member Center_Saved Searches_Company Tools',
 'BizThai, BizThai.com, BizThai member center, saved searches, Thai company tools, business research account',
 'Manage your BizThai.com profile, saved searches and Thai company research workspace for lookup, reports and AI-assisted discovery.'),
(16, 'th', 'ศูนย์สมาชิก', 'จัดการบัญชี โปรไฟล์ และพื้นที่ทำงานวิจัยบริษัทใน BizThai',
 'ศูนย์สมาชิก BizThai_การค้นหาที่บันทึก_เครื่องมือบริษัท',
 'BizThai, BizThai.com, ศูนย์สมาชิก BizThai, บันทึกการค้นหา, เครื่องมือบริษัทไทย, บัญชีวิจัยธุรกิจ',
 'จัดการโปรไฟล์ BizThai.com การค้นหาที่บันทึก และพื้นที่ทำงานวิจัยบริษัทไทยสำหรับค้นหา รายงาน และ AI'),
(16, 'zh-CN', '会员中心', '管理你的 BizThai 账户、资料和企业研究工作区。',
 'BizThai 会员中心_保存搜索_企业工具',
 'BizThai, BizThai.com, BizThai 会员中心, 保存搜索, 泰国企业工具, 商业研究账户',
 '管理 BizThai.com 资料、保存搜索和泰国企业研究工作区，用于公司查询、报告和 AI 辅助发现。'),

(17, 'en', 'Verify email', 'Verify your email to activate and protect your BizThai account.',
 'Verify BizThai Email_Account Verification',
 'BizThai, BizThai.com, verify BizThai email, account verification, Thai company search account',
 'Verify your email address to activate your BizThai.com account and protect access to company search and research tools.'),
(17, 'th', 'ยืนยันอีเมล', 'ยืนยันอีเมลเพื่อเปิดใช้งานและปกป้องบัญชี BizThai',
 'ยืนยันอีเมล BizThai_ยืนยันบัญชี',
 'BizThai, BizThai.com, ยืนยันอีเมล BizThai, ยืนยันบัญชี, บัญชีค้นหาบริษัทไทย',
 'ยืนยันอีเมลเพื่อเปิดใช้งานบัญชี BizThai.com และปกป้องการเข้าถึงเครื่องมือค้นหาและวิจัยบริษัท'),
(17, 'zh-CN', '验证邮箱', '验证邮箱以激活并保护你的 BizThai 账户。',
 '验证 BizThai 邮箱_账户验证',
 'BizThai, BizThai.com, 验证 BizThai 邮箱, 账户验证, 泰国企业查询账户',
 '验证邮箱以激活 BizThai.com 账户，并保护企业查询和研究工具的访问权限。'),

(18, 'en', 'BizThai AI', 'Ask BizThai AI to search, compare and explain Thai company records.',
 'BizThai AI_Thai Company Search Assistant_Business Data Chatbot',
 'BizThai, BizThai.com, BizThai AI, Thai company AI search, business data chatbot, company research AI',
 'Ask BizThai AI on BizThai.com to search, compare and explain Thai company records, partners, industries and business opportunities.'),
(18, 'th', 'BizThai AI', 'ถาม BizThai AI เพื่อค้นหา เปรียบเทียบ และอธิบายข้อมูลบริษัทไทย',
 'BizThai AI_ผู้ช่วยค้นหาบริษัทไทย_แชตบอตข้อมูลธุรกิจ',
 'BizThai, BizThai.com, BizThai AI, AI ค้นหาบริษัทไทย, แชตบอตข้อมูลธุรกิจ, AI วิจัยบริษัท',
 'ถาม BizThai AI บน BizThai.com เพื่อค้นหา เปรียบเทียบ และอธิบายข้อมูลบริษัทไทย คู่ค้า อุตสาหกรรม และโอกาสธุรกิจ'),
(18, 'zh-CN', 'BizThai AI', '向 BizThai AI 提问，搜索、比较并解释泰国企业记录。',
 'BizThai AI_泰国企业查询助手_商业数据聊天机器人',
 'BizThai, BizThai.com, BizThai AI, 泰国企业 AI 搜索, 商业数据聊天机器人, 企业研究 AI',
 '在 BizThai.com 向 BizThai AI 提问，搜索、比较并解释泰国公司、合作伙伴、行业和商业机会。'),

(20, 'en', 'About BizThai', 'Learn how BizThai turns Thai company information into searchable business intelligence.',
 'About BizThai_Thai Company Information Platform',
 'BizThai, BizThai.com, about BizThai, Thai company information platform, business intelligence Thailand',
 'Learn how BizThai.com turns Thai company information into searchable company profiles, business reports and multilingual research tools.'),
(20, 'th', 'เกี่ยวกับ BizThai', 'รู้จัก BizThai แพลตฟอร์มที่ทำให้ข้อมูลบริษัทไทยค้นหาและใช้งานง่าย',
 'เกี่ยวกับ BizThai_แพลตฟอร์มข้อมูลบริษัทไทย',
 'BizThai, BizThai.com, เกี่ยวกับ BizThai, แพลตฟอร์มข้อมูลบริษัทไทย, ข้อมูลธุรกิจไทย',
 'เรียนรู้ว่า BizThai.com เปลี่ยนข้อมูลบริษัทไทยให้เป็นโปรไฟล์บริษัท รายงานธุรกิจ และเครื่องมือวิจัยหลายภาษาได้อย่างไร'),
(20, 'zh-CN', '关于 BizThai', '了解 BizThai 如何把泰国企业信息变成可搜索的商业情报。',
 '关于 BizThai_泰国企业信息查询平台',
 'BizThai, BizThai.com, 关于 BizThai, 泰国企业信息平台, 泰国商业情报',
 '了解 BizThai.com 如何把泰国企业信息整理为可搜索的公司档案、商业报告和多语言研究工具。'),

(21, 'en', 'Contact us', 'Contact BizThai for questions, data corrections, partnerships and support.',
 'Contact BizThai_BizThai.com Support',
 'BizThai, BizThai.com, contact BizThai, company data support, data corrections, business partnership',
 'Contact the BizThai.com team for platform questions, data corrections, partnership enquiries or help using Thai company search tools.'),
(21, 'th', 'ติดต่อเรา', 'ติดต่อทีม BizThai สำหรับคำถาม การแก้ไขข้อมูล ความร่วมมือ และการสนับสนุน',
 'ติดต่อ BizThai_ฝ่ายสนับสนุน BizThai.com',
 'BizThai, BizThai.com, ติดต่อ BizThai, สนับสนุนข้อมูลบริษัท, แก้ไขข้อมูล, ความร่วมมือธุรกิจ',
 'ติดต่อทีม BizThai.com สำหรับคำถามเกี่ยวกับแพลตฟอร์ม การแก้ไขข้อมูล ความร่วมมือ หรือความช่วยเหลือในการค้นหาบริษัทไทย'),
(21, 'zh-CN', '联系我们', '联系 BizThai，咨询问题、数据更正、合作和支持。',
 '联系 BizThai_BizThai.com 支持',
 'BizThai, BizThai.com, 联系 BizThai, 企业数据支持, 数据更正, 商业合作',
 '联系 BizThai.com 团队，获取平台咨询、数据更正、合作洽谈或泰国企业查询工具帮助。'),

(22, 'en', 'Privacy Policy', 'Read how BizThai handles account, usage and public company information.',
 'Privacy Policy | BizThai',
 'BizThai, BizThai.com, BizThai privacy policy, data privacy, account data protection',
 'Read how BizThai.com handles account information, usage data and public company information while operating the Thai company search platform.'),
(22, 'th', 'นโยบายความเป็นส่วนตัว', 'อ่านวิธีที่ BizThai จัดการข้อมูลบัญชี การใช้งาน และข้อมูลบริษัทสาธารณะ',
 'นโยบายความเป็นส่วนตัว | BizThai',
 'BizThai, BizThai.com, นโยบายความเป็นส่วนตัว BizThai, ความเป็นส่วนตัวข้อมูล, ปกป้องข้อมูลบัญชี',
 'อ่านวิธีที่ BizThai.com จัดการข้อมูลบัญชี ข้อมูลการใช้งาน และข้อมูลบริษัทสาธารณะในการให้บริการแพลตฟอร์มค้นหาบริษัทไทย'),
(22, 'zh-CN', '隐私政策', '了解 BizThai 如何处理账户、使用行为和公开企业信息。',
 '隐私政策 | BizThai',
 'BizThai, BizThai.com, BizThai 隐私政策, 数据隐私, 账户数据保护',
 '阅读 BizThai.com 在运营泰国企业查询平台时如何处理账户信息、使用数据和公开企业信息。'),

(23, 'en', 'Terms of Service', 'Review the rules for using BizThai and Thai company information.',
 'Terms of Service | BizThai',
 'BizThai, BizThai.com, BizThai terms of service, company information terms, business research platform terms',
 'Review the terms for using BizThai.com, including acceptable use, account responsibilities, public company information and independent verification.'),
(23, 'th', 'ข้อกำหนดการใช้บริการ', 'อ่านกฎการใช้ BizThai และข้อมูลบริษัทไทย',
 'ข้อกำหนดการใช้บริการ | BizThai',
 'BizThai, BizThai.com, ข้อกำหนด BizThai, เงื่อนไขข้อมูลบริษัท, เงื่อนไขแพลตฟอร์มวิจัยธุรกิจ',
 'อ่านข้อกำหนดการใช้ BizThai.com รวมถึงการใช้งานที่เหมาะสม ความรับผิดชอบของบัญชี ข้อมูลบริษัทสาธารณะ และการตรวจสอบข้อมูลด้วยตนเอง'),
(23, 'zh-CN', '服务条款', '查看使用 BizThai 和泰国企业信息的规则。',
 '服务条款 | BizThai',
 'BizThai, BizThai.com, BizThai 服务条款, 企业信息条款, 商业研究平台条款',
 '查看使用 BizThai.com 的条款，包括可接受使用、账户责任、公开企业信息和独立核验要求。'),

(24, 'en', 'Accessibility', 'Read BizThai''s commitment to accessible Thai company search.',
 'Accessibility Statement | BizThai',
 'BizThai, BizThai.com, BizThai accessibility, accessible company search, multilingual business data',
 'Read BizThai.com''s accessibility commitment for making Thai company search and business information usable across devices, languages and abilities.'),
(24, 'th', 'การเข้าถึง', 'อ่านคำมั่นของ BizThai ต่อการเข้าถึงการค้นหาบริษัทไทย',
 'คำชี้แจงการเข้าถึง | BizThai',
 'BizThai, BizThai.com, การเข้าถึง BizThai, ค้นหาบริษัทแบบเข้าถึงได้, ข้อมูลธุรกิจหลายภาษา',
 'อ่านคำมั่นของ BizThai.com ในการทำให้การค้นหาบริษัทไทยและข้อมูลธุรกิจใช้งานได้บนอุปกรณ์ ภาษา และความสามารถที่หลากหลาย'),
(24, 'zh-CN', '无障碍', '阅读 BizThai 对无障碍泰国企业查询体验的承诺。',
 '无障碍声明 | BizThai',
 'BizThai, BizThai.com, BizThai 无障碍, 无障碍企业查询, 多语言商业数据',
 '阅读 BizThai.com 对无障碍体验的承诺，让不同设备、语言和能力的用户都能使用泰国企业查询和商业信息。');

DO $$
DECLARE
    bad_count INT;
BEGIN
    SELECT COUNT(*) INTO bad_count
    FROM tmp_page_seo_brand_i18n
    WHERE length(seo_title) > 255
       OR length(seo_keywords) > 512
       OR length(seo_description) > 512
       OR length(page_title) > 255
       OR seo_title ILIKE '%DBD%'
       OR seo_keywords ILIKE '%DBD%'
       OR seo_description ILIKE '%DBD%';
    IF bad_count > 0 THEN
        RAISE EXCEPTION 'Brand SEO backfill contains % invalid rows', bad_count;
    END IF;
END $$;

INSERT INTO cms_page_seo (site_id, page_id, seo_title, seo_keywords, seo_description, created_at, updated_at)
SELECT p.site_id, p.id, d.seo_title, d.seo_keywords, d.seo_description, now(), now()
FROM cms_pages p
JOIN tmp_page_seo_brand_i18n d ON d.page_id = p.id AND d.locale = 'th'
WHERE p.site_id = 1
ON CONFLICT (site_id, page_id) DO UPDATE SET
    seo_title = EXCLUDED.seo_title,
    seo_keywords = EXCLUDED.seo_keywords,
    seo_description = EXCLUDED.seo_description,
    updated_at = now();

INSERT INTO cms_page_translations (
    page_id,
    site_id,
    locale,
    title,
    slug,
    summary,
    body,
    body_blocks,
    translation_status,
    seo_title,
    seo_keywords,
    seo_description,
    meta_json,
    source_hash,
    segment_hashes,
    created_at,
    updated_at
)
SELECT
    p.id,
    p.site_id,
    d.locale,
    d.page_title,
    p.slug,
    d.page_summary,
    COALESCE(p.body, ''),
    p.body_blocks,
    CASE WHEN p.status = 'published' THEN 'published' ELSE 'draft' END,
    d.seo_title,
    d.seo_keywords,
    d.seo_description,
    COALESCE(p.meta_json, '{}'::jsonb),
    '',
    NULL,
    now(),
    now()
FROM cms_pages p
JOIN tmp_page_seo_brand_i18n d ON d.page_id = p.id
WHERE p.site_id = 1
ON CONFLICT (page_id, locale) DO UPDATE SET
    title = EXCLUDED.title,
    slug = EXCLUDED.slug,
    summary = EXCLUDED.summary,
    seo_title = EXCLUDED.seo_title,
    seo_keywords = EXCLUDED.seo_keywords,
    seo_description = EXCLUDED.seo_description,
    translation_status = EXCLUDED.translation_status,
    updated_at = now();

COMMIT;
