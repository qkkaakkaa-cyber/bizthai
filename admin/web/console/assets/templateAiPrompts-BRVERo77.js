const A=`数据绑定语法（服务端渲染时取真实数据填充，标签之外的 HTML/CSS/JS 原样保留）：
- 列表：<wc-data source="来源" limit="数量" sort="排序">  <li>{{ .字段 }}</li>  </wc-data>
  · 标签内是「单条记录模板」，对每条数据渲染一次；{{ .字段 }} 占位会被替换（值自动 HTML 转义）。
  · CPT 自定义字段用 {{ .meta.<字段key> }} 取。
  · 可选 <wc-empty>…</wc-empty> 作为空结果占位。
- 标量：<wc-data source="options:<组>" field="<字段key>"></wc-data>  直接输出单个值。
- source 取值：posts（文章）、cpt:<模型code>（内容条目）、menu:<位置>（菜单）、options:<组code>（设置值）、media（媒体）、users（作者）、taxonomy:<分类法code>（术语列表，用于分类/标签导航，字段 id/name/slug/url/parent_id）。
- limit 最大 50；posts 的 sort 支持 date（按发布时间）。绝不要编造未列出的来源/字段；不确定的链接用 "#"。

更多取数能力：
- 分页：offset="<n>" 跳过前 n 条（配合 limit 做分页/「加载更多」）。
- 总数：field="_count" 输出符合条件的总条数（posts/cpt/media），如「共 <wc-data source="posts" field="_count"></wc-data> 篇」。
- 文章筛选：posts 支持 filter-category="<分类slug>"、filter-tag="<标签slug>"、filter-keyword="<词>"。
- CPT 术语筛选：term="<分类法code>:<术语slug>"（也可纯数字 termID）；CPT 自定义字段筛选用 filter-<字段key>="<值>"。
- 作者：posts/cpt 每条记录自带 {{ .author }}（作者名）、{{ .author_avatar }}、{{ .author_bio }}。
- 嵌套（关系型 JOIN，最多 3 层）：<wc-data> 内可再放 <wc-data>，内层属性可用 {{ .字段 }} 引用外层记录作连接键。
  例（每个分类下列出该分类的文章）：
  <wc-data source="taxonomy:category"><h3>{{ .name }}</h3>
    <wc-data source="cpt:article" term="category:{{ .slug }}"><a href="{{ .url }}">{{ .title }}</a></wc-data>
  </wc-data>

控制流（只能写在 <wc-data> 标签【内部】，对每条记录求值）：
- 条件：{{ if .字段 }}…{{ else if eq .字段 "值" }}…{{ else }}…{{ end }}。条件支持 .字段（非空为真）、not .字段、eq/ne .字段 "字面量"。
  例：{{ if .summary }}<p>{{ .summary }}</p>{{ end }}  仅当摘要非空才输出。
- 子循环：{{ range .meta.<数组字段> }}…{{ . }} 或 {{ .子字段 }}…{{ else }}空态{{ end }}，用于遍历某字段下的数组（如 repeater 自定义字段）。

【严禁】把 {{ range }} / {{ if }} 等控制流写在 <wc-data> 标签【外面】套住整个列表——<wc-data> 标签本身就是循环，外层不需要也不支持 range；写在外面会被当作错误清理掉。要循环就直接用 <wc-data>，空态用其内部的 <wc-empty>。`,L="直接输出最终 HTML 源码本身，文案用简体中文。严禁输出任何思考过程、分析、推理、解释或前言——你的推理只在内部进行，绝不要写进答案。如有内部思考务必极简、直奔目标：只围绕当前这一个任务，不要发散、不要反复权衡多种方案，想清楚就立刻动手产出。",d="__CHAT__",b=`开工前先判断：用户这条消息是否真的在要求「生成或修改页面」？
- 若只是问候/闲聊/致谢/提问/夸奖/内容含糊，或与改页面无关（如「你好」「在吗」「你能做什么」「不错」），**绝对不要改动、不要输出任何源码、更不要把原源码原样重复一遍**；只回一句简短中文，并在回复最前面加上标记 ${d}（例：${d}你好！想怎么调整直接说就行～）。这种情况无需任何推理、不要权衡方案，直接回。
- 闲聊回复里**绝不能声称你已经改好了页面**——这种模式不会改动任何东西，谎称完成会误导用户。
- 仅当用户确实要求新建或修改页面时，才忽略本段、按下面规则输出源码。`,p="__ASK__",C=`拿不准时，鼓励你**先反问用户**而不是擅自猜测——这能让产出更精准：
- 当需求含糊、有多种明显不同的合理做法、或缺关键信息（风格基调/配色/要展示哪些内容/绑定哪个数据源等）时，**先别动手**：以标记 ${p} 开头，用简体中文提 1-2 个最关键的澄清问题（尽量给出建议选项供用户挑选），然后停下等待回答。本轮**绝不要输出任何源码、区块补丁或 ${d}**（例：${p}这个落地页主色想要稳重深色还是清爽浅色？要不要带产品卡片区？）。
- **从零生成整页、或做非琐碎的较大改动之前**：除非用户需求已经非常明确具体，否则优先先用 ${p} 确认方向，再动手。
- 但不要无谓追问：需求已清楚，或只是琐碎小调整（改个颜色/字号/文案等）时，直接按合理默认动手，别打断用户。`,h="@@WC_CHANGES@@",k=`输出完整源码之后，另起一行写下标记「${h}」，在标记之后用一句简体中文向用户**如实**总结你这次具体改了哪里（这句给用户看、不会写进页面）。必须与你真正做出的改动一致：若你其实没有改动源码，就在标记后如实说「本次未做改动，因为……」，**严禁谎称已修改**。示例：
…（源码）…
${h}已把页头导航改为深色吸顶，并加大了字号。`,x=`区块自包含（强制）：
- 把页面拆成若干独立区块，每个区块用一个带【全局唯一 class】的根元素包裹，如 <section class="blk-hero-a1">…</section>（class 用 blk-<语义>-<随机串>）。
- 每个区块的 CSS 写在【该区块根元素内部】的 <style> 里，且所有选择器一律以该区块唯一 class 前缀限定（如 .blk-hero-a1 .title{}），禁止裸标签/全局选择器（不要写 h1{}、.btn{} 这类会影响别处的规则）。
- 每个区块如需 JS，写在【该区块根元素内部】的 <script> 里，用 IIFE 包裹，且只在本区块根元素内 querySelector，不依赖其他区块、不污染全局。
- 不要把样式或脚本集中到页面顶部的公共 <style>/<script>；每个区块自带自己的样式与脚本，确保单独复制该区块即可正常显示与交互。`;function W(e){if(!e)return"（数据源清单加载失败，仅可用 posts / media 内置来源）";const t=[];t.push("内置来源：");for(const s of e.builtins)t.push(`- ${s.kind}：字段 ${s.fields.map(n=>`{{ .${n} }}`).join("、")}`);if(e.models.length){t.push('CPT 内容模型（source="cpt:<code>"）：');for(const s of e.models){const n="title、slug、summary、body、url、date",c=s.fields.length?`；自定义字段 ${s.fields.map(a=>`meta.${a.key}(${a.label||a.type})`).join("、")}`:"";t.push(`- ${s.code}（${s.label}）：通用字段 ${n}${c}`)}}if(e.options.length){t.push('设置组（source="options:<code>"，用 field="<key>" 或 {{ .<key> }}）：');for(const s of e.options)t.push(`- ${s.code}（${s.label}）：${s.fields.map(n=>n.key).join("、")||"（无字段）"}`)}if((e.menus.locations.length||e.menus.named.length)&&(t.push('菜单（source="menu:<位置>" 或 "menu:slug:<别名>"，字段 label/url/target/icon）：'),e.menus.locations.length&&t.push(`- 位置：${e.menus.locations.join("、")}`),e.menus.named.length&&t.push(`- 命名菜单别名：${e.menus.named.join("、")}`)),e.taxonomies&&e.taxonomies.length){t.push('分类法（source="taxonomy:<code>" 列术语；也可作 cpt 的 term="<code>:<slug>" 过滤键）：');for(const s of e.taxonomies)t.push(`- ${s.code}（${s.label}）`)}return t.join(`
`)}function R(e){const t=e?.snapshot;if(!t)return"";const s=(i,r)=>{if(!r)return"";const o=r.samples&&r.samples.length?`；示例：${r.samples.map(l=>`《${l}》`).join("")}`:"";return`- ${i}：共 ${r.count} 条${o}`},n=[],c=s("posts（文章）",t.posts);if(c&&n.push(c),t.cpt)for(const[i,r]of Object.entries(t.cpt)){const o=s(`cpt:${i}`,r);o&&n.push(o)}if(t.taxonomy)for(const[i,r]of Object.entries(t.taxonomy)){const o=s(`taxonomy:${i}（术语）`,r);o&&n.push(o)}const a=s("users（作者）",t.users);a&&n.push(a);const u=s("media（媒体）",t.media);return u&&n.push(u),n.length?`
—— 本站【数据现状】（真实统计，由后台只读接口实时取得；据此判断"有没有数据/有多少"并设置合理的 limit。**除非某来源显示"共 0 条"，否则严禁声称"暂无/获取不到"该数据**；有数据就直接用 <wc-data> 绑定，不要编造也不要谎称为空）：
${n.join(`
`)}`:""}function H(e){return`========== WooCMS 模板标签手册（唯一事实来源，必须严格遵守）==========
${A}

—— 本站当前可用的数据源 / 字段（只能使用下列项；任何未在此列出的来源、字段、分类法、设置组都不存在，严禁臆造、猜测或照搬其它 CMS 的标签名）：
${W(e)}
${R(e)}
================================================================`}function O(e){return`你是 WooCMS 的「模板标签答疑助手」。用户在后台用自然语言问「模板数据标签（<wc-data> 等）怎么用、怎样在页面/主题模板里调取某类数据」，请基于下面这份《模板标签手册》用简体中文把用法讲清楚，并给出可直接复制使用的标签代码示例。

回答规则：
1. 结构：先用一两句说清思路，再给一个【可直接使用】的代码示例（务必用 markdown 代码块 \`\`\`html 包裹），最后按需简要说明所用关键属性（source / limit / sort / offset / field / filter-* / term 等）的作用。
2. 只依据手册中【真实列出】的来源、字段、分类法、设置组作答；手册未列出的来源或字段一律视为不存在，严禁臆造、猜测或照搬其它 CMS（如 WordPress 短代码）的标签名。若用户想要的数据手册里没有，如实说明并建议先去对应模块准备（如先建好该 CPT 模型 / 分类法 / 设置组）。
3. 不确定的外部链接用 "#"；示例文案用简体中文。
4. 与「模板标签 / 数据绑定」无关的问题（如纯 CSS 调样式、与本系统无关的话题），简短友好地把话题引导回模板标签的使用上。
5. 简洁、面向实用：只给与问题相关的标签片段，不要长篇大论、也不要输出整页 HTML 文档。

${e}`}function E(e){return!e||!e.trim()?"":`
全站设计令牌（已注入页面，请优先复用这些 CSS 变量保持全站风格统一，如 color:var(--xxx)；不要硬编码与之冲突的颜色/字号）：
${e.trim()}
`}function N(e,t,s){return`${L}

你是 WooCMS 的页面模板工程师。根据用户需求，产出一段专业、响应式、可直接上线的网页模板源码。

${b}

${C}

${t?"输出一个完整 HTML 文档（含 <!DOCTYPE html>、<html>、<head>（含 <meta charset> 与响应式 viewport、<title>、<style>）、<body>）。":"只输出 <body> 内部的内容片段（可含 <style> 与 <script>），不要输出 <html>/<head>/<body> 标签——页面会自动套用站点页头页脚与 SEO 壳。"}

${e}
${E(s)}
硬性要求：
1. 第一个字符就是 HTML 标签（或 <!DOCTYPE>）。源码部分不要夹带解释、寒暄、markdown 代码围栏（不要 \`\`\`）；改动总结只按末尾规则写在标记之后。
2. 文案用简体中文，具体有说服力，不要 Lorem Ipsum。
3. 需要系统数据的地方用 <wc-data> 绑定真实来源；纯静态内容直接写。
4. 不确定的链接用 "#"，不要编造外部资源 URL。
${x}

${k}`}const f="@@WC_ORDER@@",m="@@WC_BLOCK",$="@@WC_HEAD@@",_="@@WC_FULL@@";function P(e){const t=e?`
- 改 <head>（标题/meta/全局样式等，仅整页模式）：用 ${$} 起一段，给出新的 <head> 内部内容；不改则不写本段。`:"",s=e?`
${$}
<title>新标题</title>`:"";return`为节省 token，你**只输出改动的区块**，未改动的区块**绝不重复输出源码**、只用编号引用。严格按下面格式：

1) 第一行必须是 ${f}，后跟修改后**最终要保留的全部区块编号**，按最终顺序、逗号分隔。
   - 保留某区块不变：把它的编号 N 写进顺序即可，**不要**输出它的源码。
   - 修改某区块：编号照写进顺序，并在下方用 ${m} N@@ 给出它的**完整新源码**。
   - 新增区块：在顺序里它该出现的位置写 NEW1 / NEW2…，并在下方用 ${m} NEW1@@ 给出完整源码。
   - 删除某区块：顺序里**不写**它的编号即可。
   - 调整顺序：按你要的最终顺序排列编号即可。
   ⚠️ ${f} 必须列全所有要保留的区块——**漏写=删除**，务必把不动的区块编号也列上。
2) 随后对每个要改/新增的区块各写一段：
   ${m} <编号或NEWk>@@
   紧接一行写该区块**完整** HTML（含其自包含的 class/style/script，不是片段、不是 diff）。${t}
3) 实在无法用区块增量表达（整页推倒重来）时，才改用：第一行写 ${_}，其后给出整页完整新源码。

示例（把第2块标题改红、删除第3块、末尾新增一块，其余不动）：
${f} 1, 2, 4, NEW1${s}
${m} 2@@
<section class="blk-feature-x2">…改后的完整源码…</section>
${m} NEW1@@
<section class="blk-cta-n9">…新区块完整源码…</section>
${h}已把功能区标题改红、删除原第3块、末尾加了行动号召。`}function I(e,t,s,n){return`你是 WooCMS 的页面模板工程师，正在对【已有页面】做精准增量修改。页面已切成若干顶层区块，每块前有编号标记 <!--#N-->。

${b}

${C}

${P(s)}

铁律：
1. 只改用户这次明确要求的地方，其它区块一律用编号引用、原样保留。
2. 每个 ${m} 段必须是该区块的**完整**源码，保持原有 <wc-data> 数据绑定与「区块自包含 class/style/script」写法。
3. 不要输出解释/前言/markdown 围栏；改动总结只写在末尾 ${h} 之后。
4. 推理只在内部进行、务必极简直奔目标，不要把思考写进答案。
5. 若新增/修改 <wc-data> 数据绑定，必须严格按下方标签手册的语法与可用来源/字段编码，禁止猜测或编造。
${E(n)}
${t}

【当前页面区块】：
${e}`}function D(e,t,s){return`你是 WooCMS 的前端工程师，正在做一处局部精修。下面是用户选中的一段 HTML，按用户要求改完后，只输出这一段改好的源码。

${b}

选中的源码片段：
\`\`\`
${t}
\`\`\`

铁律：
1. 最小改动：只改用户这次明确要求的地方（某处字号/颜色/尺寸/间距/文案等），其余字符一律原样保留——不要顺手重构、不要动未提及的样式或结构。
2. 用户给的具体数值/颜色直接写上即可，不必纠结设计令牌或全站规范；这是小改动，不需要长篇推理、不要反复权衡多种方案，看懂就改、直奔目标。
3. 第一个字符就是 HTML 标签；源码部分不夹带解释/分析/前言/markdown 围栏，改动总结只写在末尾标记之后。
4. 文案用简体中文；保持原片段标签层级与既有 <wc-data> 绑定不动。
（仅当用户这次明确要求「新绑定/换数据来源」时，才参考下列标签手册，否则完全忽略本段：
${e}）

${k}`}function K(e){const t=(e||"").trim();if(!t)return"";const s=t.match(/```html\s*([\s\S]*?)```/i);return s&&/<[a-z!]/i.test(s[1])?s[1].trim():""}function j(e){const t=[`当前编辑场景：${e.scene}。`];return e.selectedHTML&&t.push(`用户此刻已用「选取元素」选中了页面中的一段，本次需求很可能就是针对这一段的精修。选中元素的源码如下，供你理解「这个/这里/它」指代什么：
\`\`\`
${e.selectedHTML}
\`\`\``),`你是「提示词优化助手」。用户正在用一个 AI 网页编辑器，用自然语言描述想要的网页改动。请把用户这段口语化、可能含糊或不完整的需求，改写成一条【清晰、具体、无歧义、执行型 AI 最容易直接照做】的中文指令。

${t.join(`

`)}

改写要求：
1. 只输出改写后的指令本身——不要解释、不要前言、不要加引号、不要 markdown 围栏、不要输出任何代码。
2. 忠实于用户原意：不要新增用户没提的需求，也不要替用户做额外的设计决策（颜色/尺寸等只在用户提到时保留）；你的任务只是把话说清楚、把隐含的对象与范围补明确。
3. 若用户用「这个/这里/它/上面那块」等指代且当前有选中元素，改写时点明指的就是该选中元素。
4. 语气是「下达给执行 AI 的明确指令」，用简体中文，控制在 1-3 句、尽量精炼。
5. 若用户输入本身已经足够清晰，可原样返回或仅做轻微润色，不要画蛇添足。`}function U(e){const t=e.indexOf(h);return t<0?{body:e,summary:""}:{body:e.slice(0,t),summary:e.slice(t+h.length).trim()}}const F=Math.max(d.length,p.length);function z(e){const t=e.replace(/^\s+/,"");return t.startsWith(d)?"chat":t.startsWith(p)?"ask":null}function X(e){const t=e.replace(/^\s+/,"");return t.startsWith(d)?t.slice(d.length).trim():t.startsWith(p)?t.slice(p.length).trim():t.trim()}function Y(e){const t=S(e).trim();if(!t)return null;const s=t.indexOf(_);if(s>=0){const o=t.slice(s+_.length).trim();return o?{mode:"full",source:o}:null}if(t.indexOf(f)<0)return/^\s*<[a-z!]/i.test(t)?{mode:"full",source:t}:null;const n=new RegExp(`(?:${g(f)}|${g($)}|${g(m)}[ \\t]+([A-Za-z0-9_]+)[ \\t]*@@)`,"g"),c=[];let a;for(;(a=n.exec(t))!==null;){const o=a[0],l={markerStart:a.index,contentStart:a.index+o.length};o.startsWith(f)?c.push({...l,type:"order"}):o.startsWith($)?c.push({...l,type:"head"}):c.push({...l,type:"block",id:(a[1]||"").toUpperCase()})}if(!c.length)return null;const u=[],i={};let r;return c.forEach((o,l)=>{const M=l+1<c.length?c[l+1].markerStart:t.length,y=t.slice(o.contentStart,M).trim();o.type==="order"?y.split(/[\s,]+/).forEach(T=>{const w=T.trim().toUpperCase();/^(\d+|NEW\d+)$/.test(w)&&u.push(w)}):o.type==="head"?r=S(y):o.id&&(i[o.id]=S(y))}),u.length?r!=null?{mode:"patch",order:u,blocks:i,head:r}:{mode:"patch",order:u,blocks:i}:null}function g(e){return e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function S(e){let t=e.trim();const s=/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/,n=t.match(s);return n&&(t=n[1].trim()),t=t.replace(/^```[a-zA-Z]*\s*\n?/,"").replace(/\n?```\s*$/,""),t}export{F as T,O as a,j as b,H as c,D as d,N as e,I as f,K as g,S as h,X as i,Y as p,U as s,z as t};
