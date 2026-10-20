/*
 * 角色生成.js —— 一句话让 AI 生成角色的固定外貌和初始衣柜
 *
 * 角色库页面「AI 生成角色」→ 新建角色页 + 弹出输入框；编辑页里也有「AI 一句话生成」按钮（补到正在编辑的角色上）。
 * 结果只填进编辑页，点「保存」才存进角色库。
 * AI 用设置里的 AI 接口，回一段 JSON：{ name, alias, fields: { fandom, sex, hair, eyes, skin, body, extra, outfit }, outfits: [{ name, items: { 部位: 标签 } }] }
 */
(function () {
    'use strict';

    const { $, esc, toast } = UI;

    function systemPrompt() {
        const slots = Wardrobe.SLOTS.map((s) => s.k + '（' + s.label + '）').join('、');
        return `你是动漫角色设定助手。用户用一句中文描述一个角色，你给他定好固定外貌和初始衣柜，写成 NovelAI 能读的英文 Danbooru 标签。

只输出一段 JSON，不要任何解释、不要代码块标记：
{"name":"小雪","alias":"","fields":{"fandom":"","sex":"1girl","hair":"long black hair, hime cut","eyes":"blue eyes","skin":"","body":"petite","extra":"","outfit":""},"outfits":[{"name":"校服","items":{"top":"white shirt, sailor collar, red neckerchief","bottom":"pleated skirt, navy blue skirt","legwear":"black thighhighs","footwear":"loafers"}}]}

规则：
1. name：用户给了名字就照抄原文（中文名不翻译不拼音）；没给就按人设起一个合适的中文名。alias 一般留空。
2. fields 全部是英文 Danbooru 标签，逗号分隔：
   - sex：1girl 或 1boy（其他写 1other）
   - hair：必须同时有发色和长度/发型，如 long silver hair, twintails
   - eyes：必须有瞳色，如 red eyes
   - skin、body：只写有特点的（dark skin、tall、petite、large breasts…），普通就留空
   - extra：长期不变的标志特征（cat ears, cat tail, mole under eye, halo…），没有留空
   - fandom：已有作品的角色写「角色名 (作品名)」的 Danbooru 写法，如 hatsune miku (vocaloid)；原创角色留空
   - outfit：留空（衣服放进衣柜）
3. outfits：按人设给 2~4 套（比如日常、外出 / 正式、睡衣 / 居家、工作服），name 用中文。items 的键只能是：${slots}。
   - 每个部位写一到三个带颜色的英文标签（white shirt、black pleated skirt），没有的部位不写
   - dress 和 top / bottom 二选一，不要同时写
   - 内衣（bra / panties）可以写，按人设和衣服搭配；睡衣、泳装这类按实际写
4. 只用真实存在的 Danbooru 标签，不要编造词组；不要写表情、动作、场景、画质词。`;
    }

    function parse(text) {
        let t = String(text || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```(?:json)?/gi, '');
        const a = t.indexOf('{'), b = t.lastIndexOf('}');
        if (a < 0 || b <= a) throw new Error('AI 没有按格式回复 JSON');
        let j;
        try { j = JSON.parse(t.slice(a, b + 1)); } catch (e) { throw new Error('AI 回的 JSON 解析不了'); }
        const str = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '').trim();
        const fields = {};
        CharLib.FIELD_KEYS.forEach((k) => { fields[k] = str((j.fields || {})[k]); });
        if (!fields.hair && !fields.eyes && !fields.sex) throw new Error('AI 回复里没有外貌');
        const outfits = (Array.isArray(j.outfits) ? j.outfits : []).map(Wardrobe.normalizeOutfit).filter((o) => Object.keys(o.items).length);
        return { name: str(j.name), alias: str(j.alias), fields, outfits };
    }

    /** 调 AI；opt: { text, signal, onDelta } */
    async function generate(opt) {
        const api = UI.settings.ai;
        if (!String(api.url || '').trim()) throw new Error('请先在设置里填 AI 接口地址');
        if (!String(api.model || '').trim()) throw new Error('请先在设置里选 AI 模型');
        if (!String(opt.text || '').trim()) throw new Error('先写一句角色描述');
        let hint = '', lastErr = null;
        for (let i = 0; i < 2; i++) {
            const r = await Api.chat({
                api, model: api.model,
                messages: [{ role: 'system', content: systemPrompt() }, { role: 'user', content: opt.text.trim() + hint }],
                params: { stream: api.stream !== false, temperature: api.temperature },
                signal: opt.signal,
                onDelta: (c) => opt.onDelta && opt.onDelta(c),
            });
            try { return parse(r.content); } catch (e) {
                lastErr = e;
                hint = '\n\n（上次你的回复格式不对：' + e.message + '。这次只输出一段 JSON，不要别的内容。）';
            }
        }
        throw new Error(lastErr.message + '（已自动重试）');
    }

    /** 把结果填进编辑页的 d，并刷新输入框 */
    function fill(box, d, res, refresh) {
        if (!d.name.trim() && res.name) d.name = res.name;
        if (!d.alias.trim() && res.alias) d.alias = res.alias;
        CharLib.FIELD_KEYS.forEach((k) => { if (res.fields[k]) d.fields[k] = res.fields[k]; });
        d.wardrobe = Wardrobe.normalize(d.wardrobe);
        res.outfits.forEach((o) => d.wardrobe.outfits.push(o));
        if (!d.wardrobe.current && res.outfits.length) d.wardrobe.current = res.outfits[0].id;
        UI.$$('[data-f]', box).forEach((el) => {
            const k = el.dataset.f;
            if (el.type === 'checkbox') return;
            if (CharLib.FIELD_KEYS.includes(k)) el.value = d.fields[k] || '';
            else if (k === 'name' || k === 'alias') el.value = d[k] || '';
        });
        const wd = $('.wd-box', box);
        if (wd && wd.__redraw) wd.__redraw(); else refresh();
    }

    /** 输入一句话的对话框；结果填进编辑页 */
    function ask(box, d, refresh) {
        let ctl = null;
        const L = UI.openLayer('dialog', '<h3>AI 一句话生成角色</h3>'
            + '<div class="field"><textarea class="ta" data-cg-q placeholder="比如：二十岁的猫娘女仆，银色长发红眼睛，性格冷淡，平时穿女仆装，休息日穿卫衣"></textarea>'
            + '<div class="help">AI 定好外貌（头发、眼睛、体型、特征）和 2~4 套衣服，填进编辑页。满意了再点「保存」。</div></div>'
            + '<pre class="live" data-cg-live hidden></pre>'
            + '<div class="btns"><button class="btn" data-close>取消</button><button class="btn primary" data-cg-go>生成</button></div>',
        { onClose: () => ctl && ctl.abort() });
        const q = $('[data-cg-q]', L.box), live = $('[data-cg-live]', L.box), go = $('[data-cg-go]', L.box);
        q.value = d.note && !d.fields.hair ? d.note : '';
        setTimeout(() => q.focus(), 50);
        go.onclick = async () => {
            if (ctl) { ctl.abort(); return; }
            ctl = new AbortController();
            go.textContent = '停止';
            go.classList.add('danger');
            live.hidden = false;
            live.textContent = 'AI 正在写…';
            Queue.Busy.on();
            try {
                const res = await generate({ text: q.value, signal: ctl.signal, onDelta: (c) => { live.textContent = c || 'AI 正在写…'; live.scrollTop = live.scrollHeight; } });
                fill(box, d, res, refresh);
                ctl = null;
                UI.closeLayer(L);
                toast('success', '外貌和 ' + res.outfits.length + ' 套衣服已填好，看看没问题就点「保存」', '生成好了');
            } catch (e) {
                if (e.name === 'AbortError') live.textContent = '已停止';
                else { live.textContent = '出错了：' + (e.message || e); toast('error', e.message || String(e), '生成失败'); }
            } finally {
                ctl = null;
                Queue.Busy.off();
                go.textContent = '生成';
                go.classList.remove('danger');
            }
        };
        return L;
    }

    let askOnOpen = false;
    CharLib.addEditorPart({
        html: () => '<div class="btns" style="justify-content:flex-start;margin:14px 0 0"><button class="btn" data-ai-gen>AI 一句话生成外貌和衣柜</button></div>',
        bind(box, d, refresh) {
            $('[data-ai-gen]', box).onclick = () => ask(box, d, refresh);
            if (askOnOpen) { askOnOpen = false; setTimeout(() => ask(box, d, refresh), 0); }
        },
    });

    CharLib.addListAction({
        label: 'AI 生成角色',
        run: (redraw) => { askOnOpen = true; CharLib.edit(null, redraw); },
    });

    window.CharGen = { generate, parse, systemPrompt };
})();
