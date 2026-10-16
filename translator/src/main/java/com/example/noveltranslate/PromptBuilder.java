package com.example.noveltranslate;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** 拼提示词、从回复里抽译文和新术语。不依赖 Android。 */
final class PromptBuilder {
    private PromptBuilder() {}

    static final String TAG_OPEN = "<译文>";
    static final String TAG_CLOSE = "</译文>";
    static final String TERM_OPEN = "<新术语>";
    static final String TERM_CLOSE = "</新术语>";

    /** 只挑本块原文里真的出现过的术语，避免把几百条术语全塞进每次请求 */
    static List<Settings.Term> relevantTerms(List<Settings.Term> all, String source) {
        List<Settings.Term> out = new ArrayList<>();
        if (all == null || source == null) return out;
        String lower = source.toLowerCase(Locale.ROOT);
        for (Settings.Term t : all) {
            if (t.source == null || t.source.isEmpty()) continue;
            if (lower.contains(t.source.toLowerCase(Locale.ROOT))) out.add(t);
            if (out.size() >= 300) break;
        }
        return out;
    }

    static String build(Settings s, Chapter ch, String prevTail, String nextHead, List<Settings.Term> terms) {
        StringBuilder p = new StringBuilder();
        String base = TextUtil.isBlank(s.customPrompt) ? Settings.DEFAULT_PROMPT : s.customPrompt.trim();
        p.append(base).append('\n');

        if (s.glossaryEnabled && terms != null && !terms.isEmpty()) {
            p.append("\n## 术语表（必须严格遵守）\n");
            for (Settings.Term t : terms) p.append(t.source).append(" → ").append(t.target).append('\n');
        }

        if (!TextUtil.isBlank(prevTail)) {
            p.append("\n## 上文（仅供衔接参考，不要翻译，不要输出）\n<上文>\n").append(prevTail).append("\n</上文>\n");
        }
        if (!TextUtil.isBlank(nextHead)) {
            p.append("\n## 下文（仅供衔接参考，不要翻译，不要输出）\n<下文>\n").append(nextHead).append("\n</下文>\n");
        }

        int n = ch.index + 1;
        if (s.blockAsChapter) {
            p.append("\n## 章节纪律（重要）\n")
                    .append("下面给出的这一整块正文，请**当作完整的第 ").append(n).append(" 章**来处理。\n")
                    .append("- 整块合起来就是一章，**不要在块内部再划分章节**\n")
                    .append("- 即使原文中间出现「第X话」「第X章」之类的字样，也不要据此另起新章\n")
                    .append("- 不要自行添加额外的章节标题、编号或分隔线\n")
                    .append("- 只翻译下面给出的这一块内容\n");
        } else {
            p.append("\n## 章节纪律（重要）\n")
                    .append("下面给出的正文是按长度切出来的一块，**不代表章节边界**，")
                    .append("块内可能包含原文的多话/多章，也可能只是某一话的一部分。\n")
                    .append("- 必须**严格沿用原文自身的话数/章数**，原文是第几话就翻成第几话\n")
                    .append("- **不得合并**多话为一话，**不得拆分**一话为多话\n")
                    .append("- **不要**把这一块当成一章，也**不要**自行添加原文没有的章节编号\n")
                    .append("- 原文里的章节标题行照常翻译并**单独成行**保留\n");
        }

        p.append("\n## 输出格式\n")
                .append("只输出译文本身，放在 ").append(TAG_OPEN).append(" 和 ").append(TAG_CLOSE)
                .append(" 之间，标签外不要写任何解释。\n");
        if (s.glossaryEnabled && s.autoGlossary) {
            p.append("译文之后，如果本段出现了术语表里没有的人名、地名、组织名、招式等专有名词，")
                    .append("用 ").append(TERM_OPEN).append(" ").append(TERM_CLOSE)
                    .append(" 包起来列出，每行一条，格式：原文=译文。没有就不要输出这个标签。\n");
        }

        p.append("\n## 待翻译正文\n");
        if (s.blockAsChapter) p.append("本块编号：第 ").append(n).append(" 块（即第 ").append(n).append(" 章）\n");
        p.append("<原文>\n").append(ch.source).append("\n</原文>");
        return p.toString();
    }

    /** 抽出 <译文> 里的内容。没写结束标签（被截断）时取开标签之后的全部。 */
    static String extractTranslation(String raw) {
        if (raw == null) return "";
        String r = raw;
        int t = r.indexOf(TERM_OPEN);
        int open = r.indexOf(TAG_OPEN);
        if (open >= 0) {
            int from = open + TAG_OPEN.length();
            int close = r.indexOf(TAG_CLOSE, from);
            String body = close >= 0 ? r.substring(from, close) : r.substring(from);
            int ti = body.indexOf(TERM_OPEN);
            if (ti >= 0) body = body.substring(0, ti);
            return TextUtil.trimLines(body);
        }
        if (t >= 0) r = r.substring(0, t);
        // 没按格式来：去掉常见的代码块围栏后整段当译文
        r = r.replace("```", "");
        return TextUtil.trimLines(r);
    }

    /** 回复里有没有完整的结束标签。没有的话大概率是输出被截断了。 */
    static boolean hasClosingTag(String raw) {
        return raw != null && raw.contains(TAG_OPEN) && raw.contains(TAG_CLOSE);
    }

    static List<Settings.Term> extractTerms(String raw) {
        List<Settings.Term> out = new ArrayList<>();
        if (raw == null) return out;
        int open = raw.indexOf(TERM_OPEN);
        if (open < 0) return out;
        int from = open + TERM_OPEN.length();
        int close = raw.indexOf(TERM_CLOSE, from);
        String block = close >= 0 ? raw.substring(from, close) : raw.substring(from);
        for (String line : block.split("\n")) {
            String l = line.trim();
            if (l.startsWith("-") || l.startsWith("*")) l = l.substring(1).trim();
            int eq = -1;
            for (String sep : new String[] {"=", "＝", "→", "->"}) {
                eq = l.indexOf(sep);
                if (eq > 0) {
                    String src = l.substring(0, eq).trim();
                    String dst = l.substring(eq + sep.length()).trim();
                    if (!src.isEmpty() && !dst.isEmpty() && src.length() <= 40 && dst.length() <= 40) {
                        out.add(new Settings.Term(src, dst));
                    }
                    break;
                }
            }
        }
        return out;
    }
}
