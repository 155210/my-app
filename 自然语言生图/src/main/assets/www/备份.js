/*
 * 备份.js —— 设置导出 / 导入（设置页「备份」标签）
 *
 * 导出：存储里除图库、原图、草稿以外的所有键（settings 以及以后角色库、风格模板等自己存的键），
 *       打成一个 JSON 文件存到 下载/自然语言生图/。可以选不带两个 Key，方便发给别人。
 * 导入：读这个 JSON，覆盖同名的键；文件里 Key 是空的就保留手机上现有的 Key。导入后整页重开，各模块重新读设置。
 */
(function () {
    'use strict';

    const { $, toast } = UI;
    const KIND = 'nl-image-settings';
    // 不进备份的键：图库太大，草稿和更新提醒是临时状态
    const SKIP = (k) => k === 'gallery' || k === 'draft' || k === 'update' || String(k).startsWith('img:') || String(k).startsWith('tok:');
    let withKeys = false;

    function stripKeys(data) {
        const s = data.settings;
        if (!s) return data;
        const c = JSON.parse(JSON.stringify(s));
        if (c.ai) c.ai.key = '';
        if (c.nai) c.nai.key = '';
        return Object.assign({}, data, { settings: c });
    }

    async function build(includeKeys) {
        await new Promise((r) => setTimeout(r, 250)); // 等设置页的延时保存落盘
        const all = await Store.dumpAll();
        let data = {};
        Object.keys(all).filter((k) => !SKIP(k)).forEach((k) => { data[k] = all[k]; });
        if (!includeKeys) data = stripKeys(data);
        return { kind: KIND, version: 1, time: new Date().toISOString(), data };
    }

    function stamp() {
        const d = new Date(), p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
    }

    async function exportFile() {
        const obj = await build(withKeys);
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const name = '生图设置-' + stamp() + '.json';
        if (window.__IN_APP__) {
            const where = await window.__saveBlob(blob, name);
            toast('success', where, '已导出');
        } else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            toast('success', name, '已导出');
        }
    }

    /** 检查文件内容，返回要写入的 { 键: 值 } */
    function parse(text) {
        let obj;
        try { obj = JSON.parse(text); } catch (e) { throw new Error('文件不是 JSON，选错文件了？'); }
        if (!obj || obj.kind !== KIND || !obj.data || typeof obj.data !== 'object') throw new Error('这不是「自然语言生图」导出的设置文件');
        const data = {};
        Object.keys(obj.data).filter((k) => !SKIP(k)).forEach((k) => { data[k] = obj.data[k]; });
        // 文件里没带 Key 时，保留手机上现在的 Key
        const s = data.settings, cur = UI.settings;
        if (s) {
            s.ai = s.ai || {};
            s.nai = s.nai || {};
            if (!s.ai.key && cur.ai.key) s.ai.key = cur.ai.key;
            if (!s.nai.key && cur.nai.key) s.nai.key = cur.nai.key;
            data.settings = Params.normalize(s);
        }
        return { data, time: obj.time };
    }

    async function importText(text) {
        const { data, time } = parse(text);
        const n = Object.keys(data).length;
        if (!n) throw new Error('文件里没有设置');
        const when = time ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '';
        const ok = await UI.confirmBox('导入这份设置？', (when ? '导出于 ' + when + '。' : '') + '会覆盖现在的设置（图库不受影响），导入后页面会重新打开。', '导入');
        if (!ok) return false;
        await Store.restoreAll(data, true);
        toast('success', '设置已导入');
        setTimeout(() => location.reload(), 600);
        return true;
    }

    function pickFile() {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json,application/json,text/plain';
        inp.onchange = async () => {
            const f = inp.files && inp.files[0];
            if (!f) return;
            try { await importText(await f.text()); } catch (e) { toast('error', e.message || String(e), '导入失败'); }
        };
        inp.click();
    }

    function html() {
        return '<div class="card"><div class="card-title">导出设置</div>'
            + '<div class="card-sub">AI 接口、NAI 出图参数、质量词 / 负面词、画师串、自定义提示词、重型提示词等全部设置，存成一个文件放到「下载/自然语言生图」。换手机、重装前先导出一份。图库里的图不在里面。</div>'
            + '<label class="check" style="margin-top:10px"><span class="switch"><input type="checkbox" id="bk-keys"' + (withKeys ? ' checked' : '') + '><span></span></span>'
            + '<span>连 API Key 和 NAI Key 一起导出<div class="help">要发给别人用就别勾</div></span></label>'
            + '<div class="btns"><button class="btn primary" data-act="bk-export">导出设置</button></div></div>'
            + '<div class="card"><div class="card-title">导入设置</div>'
            + '<div class="card-sub">选之前导出的 .json 文件，会覆盖现在的设置。文件里没带 Key 的话，手机上现有的 Key 保留不动。</div>'
            + '<div class="btns"><button class="btn" data-act="bk-import">选择文件导入</button></div></div>';
    }

    SettingsPage.addTab({
        id: 'backup',
        label: '备份',
        html,
        acts: {
            'bk-export': async (btn) => {
                withKeys = !!($('#bk-keys') || {}).checked;
                btn.disabled = true;
                try { await exportFile(); } catch (e) { toast('error', e.message || String(e), '导出失败'); } finally { btn.disabled = false; }
            },
            'bk-import': async () => pickFile(),
        },
    });

    window.Backup = { build, parse, importText, KIND };
})();
