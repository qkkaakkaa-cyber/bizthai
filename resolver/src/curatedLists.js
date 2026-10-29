// 企业排行榜:精选命名榜单(比如"泰国食品企业100强")。SEO 目的用独立扁平 URL(不是
// /business-leaderboards?industry=X 这种参数页),标题/描述/URL 全部手写定制,不是自动生成——
// 参照 Fortune/Forbes 那种"精选榜单"做法,一个人手动维护的小规模(~20 个)列表,不是自动
// 组合爆炸出来的成百上千个筛选变体(那种页面 SEO 上是反效果,见项目里"稀疏组合 noindex"的
// 教训)。
//
// hasData:false 的条目走占位页(渲染"数据录入中",不查真实排行数据),对应现有数据里
// 完全没有的维度——员工数、验证过的出口额;EV 企业单独占位是因为 TSIC 行业分类没有细到
// "电动车"这一级,硬拿"汽车制造"充数会把传统燃油车企业也算进去,标题却叫"EV",属于误导。
//
// industry 字段可以是单个 slug 或多个 slug 的数组(见 analytics/src/db.js
// rankCompaniesByFinancials 的 industry 参数——多个 slug 之间是 OR,因为 TSIC 行业分类法
// 是扁平两层,没有"食品制造大类"这种中间分组,只能自己枚举叶子 slug 再合并)。这份枚举是
// 人工按关键词搜出来的第一版,不是详尽穷举,后续发现遗漏的细分类目可以再往数组里加。
//
// reasonTemplate:2026-07-06 新增,给"上榜原因"列/弹窗用的每榜单专属文案模版(AI 撰写,
// 渲染时把 {rank}/{company}/{value}/{year} 替换成该行实际数值,见 resolver/src/biz.js
// rankingTable 里的 fillTemplate)。只给 hasData:true 的条目写,占位榜单没有表格不需要。
// 行业/国别措辞直接写死在每条模版文字里,不再额外抽 {industry}/{scope} 占位符。国别类
// 措辞必须沿用"X资企业"而不是"X国企业"(合规要求,跟 title/desc 现有写法一致)。
export const CURATED_LISTS = [
  // ── 全国总榜 ──
  {
    slug: 'top-100-thai-companies-by-revenue',
    hasData: true,
    filters: { metric: 'revenue', limit: 100 },
    title: { en: 'Top 100 Thai Companies by Revenue', th: '100 อันดับบริษัทไทยรายได้สูงสุด', zh: '泰国营收最高100家公司' },
    desc: {
      en: 'The 100 highest-revenue companies in Thailand, ranked from filed financial statements.',
      th: '100 บริษัทที่มีรายได้สูงสุดในประเทศไทย จัดอันดับจากงบการเงินที่ยื่นจริง',
      zh: '泰国营收最高的100家企业,基于企业自己提交的财报数据排名。',
    },
    reasonTemplate: {
      en: 'Ranked #{rank} nationwide by filed revenue ({value}) for fiscal year {year}, among operating companies with a real financial statement on record — not a third-party estimate.',
      th: 'ติดอันดับที่ {rank} ของประเทศจากรายได้ที่ยื่นจริง ({value}) สำหรับปีงบ {year} ในกลุ่มบริษัทที่ดำเนินกิจการและมีงบการเงินจริงในระบบ ไม่ใช่ตัวเลขประมาณจากบุคคลที่สาม',
      zh: '{company}以已提交的营收 {value}(财年 {year})在全国运营中企业里排名第 {rank} 位——数据来自企业自行提交的财报,非第三方估算。',
    },
  },
  {
    slug: 'top-100-thai-companies-by-profit',
    hasData: true,
    filters: { metric: 'profitloss', limit: 100 },
    title: { en: 'Top 100 Most Profitable Companies in Thailand', th: '100 อันดับบริษัทไทยกำไรสูงสุด', zh: '泰国利润最高100家公司' },
    desc: {
      en: 'The 100 most profitable companies in Thailand, ranked from filed financial statements.',
      th: '100 บริษัทที่มีกำไรสูงสุดในประเทศไทย จัดอันดับจากงบการเงินที่ยื่นจริง',
      zh: '泰国利润最高的100家企业,基于企业自己提交的财报数据排名。',
    },
    reasonTemplate: {
      en: 'Ranked #{rank} by filed net profit ({value}) for fiscal year {year}, among all operating companies with a real financial statement on record — not a DBD or third-party estimate.',
      th: 'ติดอันดับที่ {rank} จากกำไรสุทธิที่ยื่นจริง ({value}) สำหรับปีงบ {year} ในกลุ่มบริษัทที่ดำเนินกิจการและมีงบการเงินจริงในระบบ ไม่ใช่ตัวเลขประมาณจาก DBD หรือบุคคลที่สาม',
      zh: '{company}以已提交的净利润 {value}(财年 {year})在所有有真实财报数据的运营中企业里排名第 {rank} 位——数据来自企业自行提交的财报,非 DBD 或第三方估算。',
    },
  },
  {
    slug: 'top-100-fastest-growing-companies-in-thailand',
    hasData: true,
    filters: { metric: 'growth', limit: 100 },
    title: { en: 'Top 100 Fastest Growing Companies in Thailand', th: '100 อันดับบริษัทไทยเติบโตเร็วที่สุด', zh: '泰国增长最快100家公司' },
    desc: {
      en: 'Ranked by year-over-year revenue growth (minimum revenue base applied to exclude statistically meaningless swings from a near-zero prior year).',
      th: 'จัดอันดับตามอัตราเติบโตของรายได้เทียบปีก่อน (กำหนดฐานรายได้ขั้นต่ำ เพื่อตัดตัวเลขที่ไม่มีนัยสำคัญจากฐานที่ใกล้ศูนย์)',
      zh: '按营收同比增长率排名(设置了最低基期营收门槛,排除基数趋近于零导致的失真百分比)。',
    },
    reasonTemplate: {
      en: '{company}\'s revenue grew {value} year-over-year in fiscal year {year}, ranking #{rank} nationwide by growth rate — a minimum prior-year revenue base is applied to exclude distorted percentages from a near-zero starting point.',
      th: 'รายได้ของ {company} เติบโต {value} เทียบปีก่อนในปีงบ {year} ติดอันดับที่ {rank} ของประเทศตามอัตราเติบโต โดยกำหนดฐานรายได้ปีก่อนขั้นต่ำเพื่อตัดตัวเลขที่บิดเบือนจากฐานที่ใกล้ศูนย์',
      zh: '{company}财年 {year} 营收同比增长 {value},在全国运营中企业里增速排名第 {rank} 位——门槛已剔除去年营收基数过低导致的失真高增长率。',
    },
  },
  // ── 分行业榜 ──
  {
    slug: 'top-100-thai-food-companies',
    hasData: true,
    filters: {
      metric: 'revenue', limit: 100,
      industry: [
        'manufacture-of-fish-products-fresh-chilled-or-frozen-10211', 'manufacture-of-fish-sauce-and-fermented-fish-products-10293',
        'manufacture-of-fishmeal-for-animal-feed-10294', 'manufacture-of-frozen-fruit-and-vegetables-10301',
        'manufacture-of-fruit-or-vegetable-juices-10303', 'preserving-of-fruit-or-vegetables-drying-salting-immersing-in-oil-or-vinegar-10304',
        'processing-and-preserving-of-other-fruit-or-vegetable-products-not-elsewhere-classified-10309', 'manufacture-of-coconut-oils-10414',
        'manufacture-of-palm-oil-10420', 'manufacture-of-other-vegetable-oils-except-palm-oils-not-elsewhere-classified-10419',
        'manufacture-of-other-dairy-products-not-elsewhere-classified-10509', 'rice-milling-10611',
        'manufacture-of-other-grain-mill-products-not-elsewhere-classified-10619', 'manufacture-of-biscuits-and-other-dry-bakery-products-10712',
        'manufacture-of-raw-sugar-from-sugarcane-10721', 'manufacture-of-thai-and-traditional-dessert-except-bakery-products-10792',
        'manufacture-of-other-food-products-not-elsewhere-classified-10799', 'manufacture-of-perishable-prepared-foods-10794',
        'wholesale-of-other-food-products-not-elsewhere-classified-46319', 'wholesale-of-fish-and-fish-products-46312',
        'wholesale-of-dairy-products-46314', 'wholesale-of-bakery-products-eggs-and-edible-oils-and-fats-of-animal-or-vegetable-origin-46316',
        'wholesale-of-meat-and-meat-products-46311', 'wholesale-of-sugar-chocolate-candy-and-sugar-confectionery-46317',
        'retail-sale-of-bakery-products-in-specialized-stores-47215', 'retail-sale-of-rice-in-specialized-stores-47214',
        'retail-sale-of-fruit-and-vegetables-in-specialized-stores-47213', 'retail-sale-of-other-food-products-in-specialized-stores-not-elsewhere-classified-47219',
      ],
    },
    title: { en: 'Top 100 Thai Food Companies', th: '100 อันดับบริษัทอาหารไทย', zh: '泰国食品企业100强' },
    desc: {
      en: 'Food and beverage manufacturers, processors, wholesalers and specialized retailers, ranked by revenue. Industry coverage is a curated first pass, not an exhaustive enumeration of every food-related TSIC code.',
      th: 'ผู้ผลิต แปรรูป ค้าส่ง และค้าปลีกเฉพาะทางด้านอาหารและเครื่องดื่ม จัดอันดับตามรายได้ ขอบเขตอุตสาหกรรมเป็นการคัดเลือกรอบแรก ยังไม่ครอบคลุมทุกรหัส TSIC ที่เกี่ยวกับอาหาร',
      zh: '食品/饮料的制造、加工、批发及专营零售企业,按营收排名。行业范围是首版人工筛选,尚未穷举所有食品相关 TSIC 细分代码。',
    },
    reasonTemplate: {
      en: '{company} ranks #{rank} among Thai food & beverage manufacturers, processors, wholesalers and specialized retailers, with reported revenue of {value} in fiscal year {year}.',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มผู้ผลิต แปรรูป ค้าส่ง และค้าปลีกเฉพาะทางด้านอาหารและเครื่องดื่มของไทย ด้วยรายได้ที่รายงาน {value} ในปีงบ {year}',
      zh: '{company}在泰国食品/饮料制造、加工、批发及专营零售企业中排名第 {rank} 位,财年 {year} 申报营收为 {value}。',
    },
  },
  {
    slug: 'top-100-logistics-companies-in-thailand',
    hasData: true,
    filters: { metric: 'revenue', limit: 100, industry: ['tsic-h'] },
    title: { en: 'Top 100 Logistics Companies in Thailand', th: '100 อันดับบริษัทขนส่งและโลจิสติกส์ไทย', zh: '泰国物流企业100强' },
    desc: {
      en: 'Transportation and storage companies, ranked by revenue.',
      th: 'บริษัทด้านการขนส่งและสถานที่เก็บสินค้า จัดอันดับตามรายได้',
      zh: '运输与仓储类企业,按营收排名。',
    },
    reasonTemplate: {
      en: '{company} ranks #{rank} among Thailand\'s transportation and storage companies, with reported revenue of {value} in fiscal year {year}.',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มบริษัทด้านการขนส่งและสถานที่เก็บสินค้าของไทย ด้วยรายได้ที่รายงาน {value} ในปีงบ {year}',
      zh: '{company}在泰国运输与仓储类企业中排名第 {rank} 位,财年 {year} 申报营收为 {value}。',
    },
  },
  {
    slug: 'top-100-manufacturers-in-thailand',
    hasData: true,
    filters: { metric: 'revenue', limit: 100, industry: ['tsic-c'] },
    title: { en: 'Top 100 Manufacturers in Thailand', th: '100 อันดับบริษัทผู้ผลิตไทย', zh: '泰国制造企业100强' },
    desc: {
      en: 'Manufacturing companies across all sectors, ranked by revenue.',
      th: 'บริษัทผู้ผลิตในทุกภาคอุตสาหกรรม จัดอันดับตามรายได้',
      zh: '涵盖所有细分领域的制造业企业,按营收排名。',
    },
    reasonTemplate: {
      en: '{company} ranks #{rank} among manufacturing companies across all sectors in Thailand, with reported revenue of {value} in fiscal year {year}.',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มบริษัทผู้ผลิตทุกภาคอุตสาหกรรมของไทย ด้วยรายได้ที่รายงาน {value} ในปีงบ {year}',
      zh: '{company}在泰国全行业制造企业中排名第 {rank} 位,财年 {year} 申报营收为 {value}。',
    },
  },
  {
    slug: 'top-100-retail-companies-in-thailand',
    hasData: true,
    filters: {
      metric: 'revenue', limit: 100,
      industry: [
        'retail-of-new-motor-vehicle-parts-and-accessories-45302', 'retail-of-new-motorcycle-parts-and-accessories-45403', 'retail-sale-by-direct-sales-47991',
        'retail-sale-of-a-variety-of-construction-materials-including-do-it-yourself-material-and-equipment-in-specialized-stores-47525',
        'retail-sale-of-alcohol-beverages-in-specialized-stores-47221', 'retail-sale-of-antiques-47741', 'retail-sale-of-audio-and-video-equipment-in-specialized-stores-47420',
        'retail-sale-of-automotive-fuel-in-specialized-stores-47300', 'retail-sale-of-bakery-products-in-specialized-stores-47215',
        'retail-sale-of-books-newspapers-periodicals-and-magazines-in-specialized-stores-47611',
        'retail-sale-of-carpets-rugs-wall-and-floor-coverings-in-specialized-stores-47530', 'retail-sale-of-chinaware-glassware-and-kitchenware-in-specialized-stores-47592',
        'retail-sale-of-clothing-in-specialized-stores-47711', 'retail-sale-of-computers-and-peripheral-units-in-specialized-stores-47411',
        'retail-sale-of-cosmetics-and-toilet-preparations-in-specialized-stores-47723', 'retail-sale-of-electrical-household-appliances-in-specialized-stores-47595',
        'retail-sale-of-flowers-plants-and-related-equipment-in-specialized-stores-47733', 'retail-sale-of-footwear-in-specialized-stores-47712',
        'retail-sale-of-fruit-and-vegetables-in-specialized-stores-47213', 'retail-sale-of-games-and-toys-in-specialized-stores-47640',
        'retail-sale-of-haberdashery-in-specialized-stores-47513', 'retail-sale-of-household-articles-of-textiles-in-specialized-stores-47512',
        'retail-sale-of-household-fuel-oil-bottled-gas-wood-and-other-fuel-in-specialized-stores-47735', 'retail-sale-of-household-furniture-in-specialized-stores-47591',
        'retail-sale-of-jewellery-in-specialized-stores-47732', 'retail-sale-of-leather-articles-in-specialized-stores-except-footwear-47713',
        'retail-sale-of-lighting-equipment-in-specialized-stores-47593', 'retail-sale-of-metal-products-47521', 'retail-sale-of-non-alcohol-beverages-in-specialized-stores-47222',
        'retail-sale-of-other-construction-materials-in-specialized-stores-47524', 'retail-sale-of-other-food-products-in-specialized-stores-not-elsewhere-classified-47219',
        'retail-sale-of-other-household-articles-not-elsewhere-classified-in-specialized-stores-47599', 'retail-sale-of-other-second-hand-goods-not-elsewhere-classified-47749',
        'retail-sale-of-perfumeries-in-specialized-stores-47722', 'retail-sale-of-pet-animals-and-related-equipment-in-specialized-stores-47734',
        'retail-sale-of-pharmaceutical-and-medical-goods-in-specialized-stores-47721', 'retail-sale-of-plumbing-heating-and-sanitary-equipment-and-supplies-in-specialized-stores-47523',
        'retail-sale-of-rice-in-specialized-stores-47214', 'retail-sale-of-second-hand-clothing-footwear-and-leather-articles-47742',
        'retail-sale-of-second-hand-computer-and-telecommunication-equipment-47743', 'retail-sale-of-sporting-equipment-in-specialized-stores-47630',
        'retail-sale-of-stationary-and-office-supplies-in-specialized-stores-47612', 'retail-sale-of-telecommunications-equipment-in-specialized-stores-47413',
        'retail-sale-of-thai-handicrafts-and-souvenirs-in-specialized-stores-47691', 'retail-sale-of-video-game-consoles-and-software-in-specialized-stores-47412',
        'retail-sale-of-watches-eyeglasses-and-photographic-equipment-in-specialized-stores-47731', 'retail-sale-of-yarn-and-fabrics-in-specialized-stores-47511',
        'retail-sale-via-internet-47912', 'retail-sale-via-mail-order-houses-47911', 'retail-sale-via-stalls-and-markets-of-beverages-47812',
        'retail-sale-via-stalls-and-markets-of-other-goods-not-elsewhere-classified-47899',
      ],
    },
    title: { en: 'Top 100 Retail Companies in Thailand', th: '100 อันดับบริษัทค้าปลีกไทย', zh: '泰国零售企业100强' },
    desc: {
      en: 'Retail-sale companies (excludes wholesale), ranked by revenue.',
      th: 'บริษัทค้าปลีก (ไม่รวมค้าส่ง) จัดอันดับตามรายได้',
      zh: '零售类企业(不含批发),按营收排名。',
    },
    reasonTemplate: {
      en: '{company} ranks #{rank} among Thailand\'s retail-sale companies (wholesale excluded), with reported revenue of {value} in fiscal year {year}.',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มบริษัทค้าปลีกของไทย (ไม่รวมค้าส่ง) ด้วยรายได้ที่รายงาน {value} ในปีงบ {year}',
      zh: '{company}在泰国零售类企业(不含批发)中排名第 {rank} 位,财年 {year} 申报营收为 {value}。',
    },
  },
  {
    slug: 'top-100-construction-companies-in-thailand',
    hasData: true,
    filters: { metric: 'revenue', limit: 100, industry: ['tsic-f'] },
    title: { en: 'Top 100 Construction Companies in Thailand', th: '100 อันดับบริษัทก่อสร้างไทย', zh: '泰国建筑企业100强' },
    desc: {
      en: 'Construction companies, ranked by revenue.',
      th: 'บริษัทก่อสร้าง จัดอันดับตามรายได้',
      zh: '建筑类企业,按营收排名。',
    },
    reasonTemplate: {
      en: '{company} ranks #{rank} among Thailand\'s construction companies, with reported revenue of {value} in fiscal year {year}.',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มบริษัทก่อสร้างของไทย ด้วยรายได้ที่รายงาน {value} ในปีงบ {year}',
      zh: '{company}在泰国建筑类企业中排名第 {rank} 位,财年 {year} 申报营收为 {value}。',
    },
  },
  {
    slug: 'top-100-hotels-in-thailand',
    hasData: true,
    filters: {
      metric: 'revenue', limit: 100,
      industry: ['hotels-and-resort-hotels-55101', 'other-accommodation-not-elsewhere-classified-55909', 'other-short-term-accommodation-activities-not-elsewhere-classified-55109'],
    },
    title: { en: 'Top 100 Hotels in Thailand', th: '100 อันดับโรงแรมไทย', zh: '泰国酒店企业100强' },
    desc: {
      en: 'Hotels, resorts and short-term accommodation companies, ranked by revenue (excludes restaurants and food service).',
      th: 'โรงแรม รีสอร์ท และที่พักระยะสั้น จัดอันดับตามรายได้ (ไม่รวมร้านอาหาร)',
      zh: '酒店、度假村及短租住宿类企业,按营收排名(不含餐饮服务)。',
    },
    reasonTemplate: {
      en: '{company} ranks #{rank} among Thailand\'s hotels, resorts and short-term accommodation companies (restaurants and food service excluded), with reported revenue of {value} in fiscal year {year}.',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มโรงแรม รีสอร์ท และที่พักระยะสั้นของไทย (ไม่รวมร้านอาหาร) ด้วยรายได้ที่รายงาน {value} ในปีงบ {year}',
      zh: '{company}在泰国酒店、度假村及短租住宿类企业(不含餐饮服务)中排名第 {rank} 位,财年 {year} 申报营收为 {value}。',
    },
  },
  {
    slug: 'top-100-hospitals-in-thailand',
    hasData: true,
    filters: { metric: 'revenue', limit: 100, industry: ['hospital-activities-except-specialized-hospital-activities-86101', 'specialized-hospital-activities-86102'] },
    title: { en: 'Top 100 Hospitals in Thailand', th: '100 อันดับโรงพยาบาลไทย', zh: '泰国医院100强' },
    desc: {
      en: 'Hospital operators (general and specialized), ranked by revenue.',
      th: 'ผู้ดำเนินกิจการโรงพยาบาล (ทั่วไปและเฉพาะทาง) จัดอันดับตามรายได้',
      zh: '医院运营企业(综合及专科),按营收排名。',
    },
    reasonTemplate: {
      en: '{company} ranks #{rank} among Thailand\'s hospital operators (general and specialized), with reported revenue of {value} in fiscal year {year}.',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มผู้ดำเนินกิจการโรงพยาบาลของไทย (ทั่วไปและเฉพาะทาง) ด้วยรายได้ที่รายงาน {value} ในปีงบ {year}',
      zh: '{company}在泰国医院运营企业(综合及专科)中排名第 {rank} 位,财年 {year} 申报营收为 {value}。',
    },
  },
  {
    slug: 'top-100-universities-in-thailand',
    hasData: true,
    filters: { metric: 'revenue', limit: 100, industry: ['bachelor-s-degree-education-85302'] },
    title: { en: 'Top 100 Universities in Thailand', th: '100 อันดับมหาวิทยาลัยไทย', zh: '泰国大学100强' },
    desc: {
      en: 'Bachelor’s-degree-granting institutions registered as companies, ranked by revenue. Public universities not registered as companies are not covered.',
      th: 'สถาบันที่ให้ปริญญาตรีซึ่งจดทะเบียนเป็นนิติบุคคล จัดอันดับตามรายได้ ไม่รวมมหาวิทยาลัยรัฐที่ไม่ได้จดทะเบียนเป็นบริษัท',
      zh: '以公司形式注册、提供学士学位教育的机构,按营收排名。未以公司形式注册的公立大学不在覆盖范围内。',
    },
    reasonTemplate: {
      en: '{company} ranks #{rank} among Thailand\'s company-registered, bachelor\'s-degree-granting institutions, with reported revenue of {value} in fiscal year {year} (public universities not registered as companies aren\'t covered).',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มสถาบันที่จดทะเบียนเป็นนิติบุคคลและให้ปริญญาตรีของไทย ด้วยรายได้ที่รายงาน {value} ในปีงบ {year} (ไม่รวมมหาวิทยาลัยรัฐที่ไม่ได้จดทะเบียนเป็นบริษัท)',
      zh: '{company}在以公司形式注册、提供学士学位教育的泰国机构中排名第 {rank} 位,财年 {year} 申报营收为 {value}(未以公司形式注册的公立大学不在统计范围)。',
    },
  },
  {
    slug: 'top-100-tech-companies-in-thailand',
    hasData: true,
    filters: { metric: 'revenue', limit: 100, industry: ['tsic-j'] },
    title: { en: 'Top 100 Tech Companies in Thailand', th: '100 อันดับบริษัทเทคโนโลยีไทย', zh: '泰国科技企业100强' },
    desc: {
      en: 'Information and communication companies (IT services, telecom, software, media), ranked by revenue.',
      th: 'บริษัทด้านข้อมูลข่าวสารและการสื่อสาร (ไอที โทรคมนาคม ซอฟต์แวร์ สื่อ) จัดอันดับตามรายได้',
      zh: '信息与通信类企业(IT服务、电信、软件、媒体),按营收排名。',
    },
    reasonTemplate: {
      en: '{company} ranks #{rank} among Thailand\'s information and communication companies (IT services, telecom, software, media), with reported revenue of {value} in fiscal year {year}.',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มบริษัทด้านข้อมูลข่าวสารและการสื่อสารของไทย (ไอที โทรคมนาคม ซอฟต์แวร์ สื่อ) ด้วยรายได้ที่รายงาน {value} ในปีงบ {year}',
      zh: '{company}在泰国信息与通信类企业(IT服务、电信、软件、媒体)中排名第 {rank} 位,财年 {year} 申报营收为 {value}。',
    },
  },
  {
    slug: 'top-100-real-estate-developers-in-thailand',
    hasData: true,
    filters: { metric: 'revenue', limit: 100, industry: ['tsic-l'] },
    title: { en: 'Top 100 Real Estate Developers in Thailand', th: '100 อันดับผู้พัฒนาอสังหาริมทรัพย์ไทย', zh: '泰国房地产开发企业100强' },
    desc: {
      en: 'Real estate companies, ranked by revenue.',
      th: 'บริษัทอสังหาริมทรัพย์ จัดอันดับตามรายได้',
      zh: '房地产类企业,按营收排名。',
    },
    reasonTemplate: {
      en: '{company} ranks #{rank} among Thailand\'s real estate companies, with reported revenue of {value} in fiscal year {year}.',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มบริษัทอสังหาริมทรัพย์ของไทย ด้วยรายได้ที่รายงาน {value} ในปีงบ {year}',
      zh: '{company}在泰国房地产类企业中排名第 {rank} 位,财年 {year} 申报营收为 {value}。',
    },
  },
  {
    slug: 'top-100-seafood-companies-in-thailand',
    hasData: true,
    filters: {
      metric: 'revenue', limit: 100,
      industry: ['manufacture-of-fish-products-fresh-chilled-or-frozen-10211', 'manufacture-of-fish-sauce-and-fermented-fish-products-10293', 'manufacture-of-fishmeal-for-animal-feed-10294', 'wholesale-of-fish-and-fish-products-46312'],
    },
    title: { en: 'Top 100 Seafood Companies in Thailand', th: '100 อันดับบริษัทอาหารทะเลไทย', zh: '泰国海鲜企业100强' },
    desc: {
      en: 'Fish and seafood processing and wholesale companies, ranked by revenue. Renamed from "Exporters" — verified export volume isn’t in the underlying data, this reflects industry classification only.',
      th: 'บริษัทแปรรูปและค้าส่งปลาและอาหารทะเล จัดอันดับตามรายได้ (ไม่ได้ยืนยันปริมาณส่งออกจริง สะท้อนเฉพาะประเภทอุตสาหกรรม)',
      zh: '水产/海鲜加工与批发类企业,按营收排名。(未使用"出口企业"这个说法——数据里没有经核实的出口量,这里只反映行业分类,不代表实际出口活动。)',
    },
    reasonTemplate: {
      en: '{company} ranks #{rank} among Thailand\'s fish and seafood processing and wholesale companies, with reported revenue of {value} in fiscal year {year} (reflects industry classification, not verified export activity).',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มบริษัทแปรรูปและค้าส่งปลาและอาหารทะเลของไทย ด้วยรายได้ที่รายงาน {value} ในปีงบ {year} (สะท้อนประเภทอุตสาหกรรม ไม่ใช่ปริมาณส่งออกที่ยืนยันแล้ว)',
      zh: '{company}在泰国水产/海鲜加工与批发类企业中排名第 {rank} 位,财年 {year} 申报营收为 {value}(反映行业分类,不代表经核实的出口活动)。',
    },
  },
  {
    slug: 'top-100-agriculture-companies-in-thailand',
    hasData: true,
    filters: { metric: 'revenue', limit: 100, industry: ['tsic-a'] },
    title: { en: 'Top 100 Agriculture Companies in Thailand', th: '100 อันดับบริษัทเกษตรไทย', zh: '泰国农业企业100强' },
    desc: {
      en: 'Agriculture, forestry and fishing companies, ranked by revenue.',
      th: 'บริษัทเกษตรกรรม ป่าไม้ และประมง จัดอันดับตามรายได้',
      zh: '农林牧渔类企业,按营收排名。',
    },
    reasonTemplate: {
      en: '{company} ranks #{rank} among Thailand\'s agriculture, forestry and fishing companies, with reported revenue of {value} in fiscal year {year}.',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มบริษัทเกษตรกรรม ป่าไม้ และประมงของไทย ด้วยรายได้ที่รายงาน {value} ในปีงบ {year}',
      zh: '{company}在泰国农林牧渔类企业中排名第 {rank} 位,财年 {year} 申报营收为 {value}。',
    },
  },
  // ── 国别榜 ──
  {
    slug: 'top-500-chinese-companies-in-thailand',
    hasData: true,
    filters: { metric: 'revenue', limit: 500, natCode: 'CN' },
    title: { en: 'Top 500 Chinese-Invested Companies in Thailand', th: '500 อันดับบริษัทที่มีทุนจีนในไทย', zh: '中资企业在泰国500强' },
    desc: {
      en: 'Companies in Thailand with Chinese shareholder capital present (any share, not just majority-owned), ranked by revenue. A company with shareholders from multiple countries can also appear on those countries’ lists.',
      th: 'บริษัทในไทยที่มีผู้ถือหุ้นสัญชาติจีน (ไม่จำกัดเฉพาะถือหุ้นข้างมาก) จัดอันดับตามรายได้ บริษัทที่มีผู้ถือหุ้นหลายสัญชาติอาจปรากฏในหลายอันดับประเทศ',
      zh: '在泰国注册、股权中有中国资本来源的企业(不要求控股比例),按营收排名。若一家企业同时有多国资本来源,也会同时出现在对应国家的榜单里。',
    },
    reasonTemplate: {
      en: '{company} ranks #{rank} among Chinese-invested companies in Thailand, with reported revenue of {value} in fiscal year {year}. Ranking reflects any level of Chinese shareholder capital, not majority ownership only — a company with shareholders from multiple countries can appear on more than one country\'s list.',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มบริษัทที่มีทุนจีนในไทย ด้วยรายได้ที่รายงาน {value} ในปีงบ {year} การจัดอันดับนับรวมทุกระดับสัดส่วนผู้ถือหุ้นสัญชาติจีน ไม่จำกัดเฉพาะถือหุ้นข้างมาก บริษัทที่มีผู้ถือหุ้นหลายสัญชาติอาจปรากฏในหลายอันดับประเทศ',
      zh: '{company}在中资企业(在泰国有中国资本来源的企业)榜单中排名第 {rank} 位,财年 {year} 申报营收为 {value}。排名计入任意比例的中国资本来源,不要求控股,一家企业若有多国资本来源也会同时出现在对应国家榜单里。',
    },
  },
  {
    slug: 'top-100-japanese-companies-in-thailand',
    hasData: true,
    filters: { metric: 'revenue', limit: 100, natCode: 'JP' },
    title: { en: 'Top 100 Japanese-Invested Companies in Thailand', th: '100 อันดับบริษัทที่มีทุนญี่ปุ่นในไทย', zh: '日资企业在泰国100强' },
    desc: {
      en: 'Companies in Thailand with Japanese shareholder capital present, ranked by revenue.',
      th: 'บริษัทในไทยที่มีผู้ถือหุ้นสัญชาติญี่ปุ่น จัดอันดับตามรายได้',
      zh: '在泰国注册、股权中有日本资本来源的企业,按营收排名。',
    },
    reasonTemplate: {
      en: '{company} is ranked #{rank} among Japanese-invested companies in Thailand, with reported revenue of {value} in fiscal year {year}. Ranking reflects any level of Japanese shareholder capital, not majority ownership only.',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มบริษัทที่มีทุนญี่ปุ่นในไทย ด้วยรายได้ที่รายงาน {value} ในปีงบ {year} การจัดอันดับนับรวมทุกระดับสัดส่วนผู้ถือหุ้นสัญชาติญี่ปุ่น ไม่จำกัดเฉพาะถือหุ้นข้างมาก',
      zh: '{company}在日资企业(在泰国有日本资本来源的企业)榜单中排名第 {rank} 位,财年 {year} 申报营收为 {value}。排名计入任意比例的日本资本来源,不要求控股。',
    },
  },
  {
    slug: 'top-100-korean-companies-in-thailand',
    hasData: true,
    filters: { metric: 'revenue', limit: 100, natCode: 'KR' },
    title: { en: 'Top 100 Korean-Invested Companies in Thailand', th: '100 อันดับบริษัทที่มีทุนเกาหลีใต้ในไทย', zh: '韩资企业在泰国100强' },
    desc: {
      en: 'Companies in Thailand with South Korean shareholder capital present, ranked by revenue.',
      th: 'บริษัทในไทยที่มีผู้ถือหุ้นสัญชาติเกาหลีใต้ จัดอันดับตามรายได้',
      zh: '在泰国注册、股权中有韩国资本来源的企业,按营收排名。',
    },
    reasonTemplate: {
      en: '{company} is ranked #{rank} among South Korean-invested companies in Thailand, with reported revenue of {value} in fiscal year {year}. Ranking reflects any level of Korean shareholder capital, not majority ownership only.',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มบริษัทที่มีทุนเกาหลีใต้ในไทย ด้วยรายได้ที่รายงาน {value} ในปีงบ {year} การจัดอันดับนับรวมทุกระดับสัดส่วนผู้ถือหุ้นสัญชาติเกาหลีใต้ ไม่จำกัดเฉพาะถือหุ้นข้างมาก',
      zh: '{company}在韩资企业(在泰国有韩国资本来源的企业)榜单中排名第 {rank} 位,财年 {year} 申报营收为 {value}。排名计入任意比例的韩国资本来源,不要求控股。',
    },
  },
  {
    slug: 'top-100-foreign-owned-companies-in-thailand',
    hasData: true,
    filters: { metric: 'revenue', limit: 100, natCode: 'FOREIGN' },
    title: { en: 'Top 100 Foreign-Invested Companies in Thailand', th: '100 อันดับบริษัททุนต่างชาติในไทย', zh: '泰国外资企业100强' },
    desc: {
      en: 'Companies in Thailand with any non-Thai shareholder capital, ranked by revenue.',
      th: 'บริษัทในไทยที่มีผู้ถือหุ้นต่างชาติ (สัญชาติใดก็ได้) จัดอันดับตามรายได้',
      zh: '在泰国注册、股权中有任意非泰籍资本来源的企业,按营收排名。',
    },
    reasonTemplate: {
      en: '{company} is ranked #{rank} among foreign-invested companies in Thailand (any non-Thai shareholder capital), with reported revenue of {value} in fiscal year {year}.',
      th: '{company} ติดอันดับที่ {rank} ในกลุ่มบริษัททุนต่างชาติในไทย (ผู้ถือหุ้นต่างชาติสัญชาติใดก็ได้) ด้วยรายได้ที่รายงาน {value} ในปีงบ {year}',
      zh: '{company}在泰国外资企业(含任意非泰籍资本来源)榜单中排名第 {rank} 位,财年 {year} 申报营收为 {value}。',
    },
  },
  // ── 暂无数据,占位 ──
  {
    slug: 'top-100-companies-by-employees-in-thailand',
    hasData: false,
    title: { en: 'Top 100 Companies by Employees in Thailand', th: '100 อันดับบริษัทไทยจำนวนพนักงานมากที่สุด', zh: '泰国员工数最多100家公司' },
    desc: {
      en: 'We don’t yet have verified employee-headcount data for Thai companies — this list is coming as we add that data source.',
      th: 'เรายังไม่มีข้อมูลจำนวนพนักงานที่ยืนยันแล้วสำหรับบริษัทไทย รายการนี้จะเปิดให้ใช้งานเมื่อเราเพิ่มแหล่งข้อมูลนี้',
      zh: '目前还没有经核实的泰国企业员工人数数据,这份榜单会在补充该数据源后上线。',
    },
  },
  {
    slug: 'top-100-exporters-in-thailand',
    hasData: false,
    title: { en: 'Top 100 Exporters in Thailand', th: '100 อันดับผู้ส่งออกไทย', zh: '泰国出口企业100强' },
    desc: {
      en: 'We don’t yet have verified export-volume data for Thai companies — this list is coming as we add that data source.',
      th: 'เรายังไม่มีข้อมูลปริมาณการส่งออกที่ยืนยันแล้วสำหรับบริษัทไทย รายการนี้จะเปิดให้ใช้งานเมื่อเราเพิ่มแหล่งข้อมูลนี้',
      zh: '目前还没有经核实的泰国企业出口额数据,这份榜单会在补充该数据源后上线。',
    },
  },
  {
    slug: 'top-100-ev-companies-in-thailand',
    hasData: false,
    title: { en: 'Top 100 EV Companies in Thailand', th: '100 อันดับบริษัทยานยนต์ไฟฟ้าไทย', zh: '泰国电动车企业100强' },
    desc: {
      en: 'Thailand’s standard industry classification doesn’t distinguish electric-vehicle manufacturing from general motor-vehicle manufacturing — we won’t publish a list mislabeled "EV" that actually mixes in conventional automakers. Coming once we have a reliable way to identify EV-specific companies.',
      th: 'ระบบจัดประเภทอุตสาหกรรมมาตรฐานของไทยไม่แยกการผลิตยานยนต์ไฟฟ้าออกจากการผลิตยานยนต์ทั่วไป เราจะไม่เผยแพร่รายการที่ติดป้าย "EV" แต่จริง ๆ รวมผู้ผลิตรถยนต์สันดาปทั่วไปด้วย จะเปิดให้ใช้งานเมื่อมีวิธีระบุบริษัท EV ที่น่าเชื่อถือ',
      zh: '泰国标准行业分类里没有把"电动车制造"和"普通汽车制造"分开,我们不会挂着"EV"的名字却混入传统燃油车企业。等有可靠的方式识别真正的电动车企业后再上线。',
    },
  },
]

export const CURATED_LIST_MAP = new Map(CURATED_LISTS.map(l => [l.slug, l]))
