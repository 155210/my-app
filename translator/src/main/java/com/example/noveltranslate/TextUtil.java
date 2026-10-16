package com.example.noveltranslate;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CharsetDecoder;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 纯文本处理：token 估算、按长度切块、章节正则、中文数字、编码识别。不依赖 Android。 */
final class TextUtil {
    private TextUtil() {}

    // 小说里「第X话」「第X章」「第X节」「第X回」都常见，默认正则必须全都认
    static final String CHAPTER_UNITS = "话話章節节回幕卷篇";
    static final String CN_NUM = "0-9０-９一二三四五六七八九十百千零〇两壹贰叁肆伍陆柒捌玖拾佰仟";
    static final String DEFAULT_CHAPTER_REGEX =
            "第([" + CN_NUM + "]+)[" + CHAPTER_UNITS + "][ \\t：:、.．-]*(.*)";

    static final String[][] REGEX_PRESETS = {
        {"通用：第X话/章/节/回（推荐）", DEFAULT_CHAPTER_REGEX},
        {"只认 第X话", "第([" + CN_NUM + "]+)[话話][ \\t：:、.．-]*(.*)"},
        {"只认 第X章", "第([" + CN_NUM + "]+)章[ \\t：:、.．-]*(.*)"},
        {"只认 第X节", "第([" + CN_NUM + "]+)[节節][ \\t：:、.．-]*(.*)"},
        {"只认 第X回", "第([" + CN_NUM + "]+)回[ \\t：:、.．-]*(.*)"},
        {"标题独占一行（更严格）", "^\\s*第([" + CN_NUM + "]+)[" + CHAPTER_UNITS + "][ \\t：:、.．-]*(.*)$"},
        {"Chapter X", "Chapter\\s+([0-9]+)[\\s.:：-]*(.*)"},
        {"纯数字标题行", "^\\s*([0-9]+)\\s*$()"},
    };

    private static final Pattern UNIT_IN_MATCH =
            Pattern.compile("[" + CN_NUM + "]\\s*([" + CHAPTER_UNITS + "])");
    private static final Pattern PART_TITLE = Pattern.compile("^第\\d+部分$");

    // ================= 基础 =================

    static boolean isBlank(String s) {
        if (s == null) return true;
        for (int i = 0; i < s.length(); i++) {
            if (!Character.isWhitespace(s.charAt(i)) && s.charAt(i) != '　') return false;
        }
        return true;
    }

    static String tail(String s, int n) {
        if (s == null || n <= 0) return "";
        return s.length() <= n ? s : s.substring(s.length() - n);
    }

    static String head(String s, int n) {
        if (s == null || n <= 0) return "";
        return s.length() <= n ? s : s.substring(0, n);
    }

    static String normalizeNewlines(String s) {
        if (s == null) return "";
        return s.replace("\r\n", "\n").replace('\r', '\n');
    }

    /** 只去掉首尾的空行/半角空白，保留中文段首的全角缩进 */
    static String trimLines(String s) {
        if (s == null) return "";
        int start = 0;
        int end = s.length();
        while (start < end && (s.charAt(start) == '\n' || s.charAt(start) == ' ' || s.charAt(start) == '\t')) start++;
        while (end > start && Character.isWhitespace(s.charAt(end - 1))) end--;
        return s.substring(start, end);
    }

    private static boolean isCjk(int cp) {
        Character.UnicodeScript sc = Character.UnicodeScript.of(cp);
        if (sc == Character.UnicodeScript.HAN
                || sc == Character.UnicodeScript.HIRAGANA
                || sc == Character.UnicodeScript.KATAKANA
                || sc == Character.UnicodeScript.HANGUL) {
            return true;
        }
        Character.UnicodeBlock b = Character.UnicodeBlock.of(cp);
        return b == Character.UnicodeBlock.CJK_SYMBOLS_AND_PUNCTUATION
                || b == Character.UnicodeBlock.HALFWIDTH_AND_FULLWIDTH_FORMS;
    }

    /** token 粗估：中日韩按一字一个，其余按四个字符一个。和网页版、世界书模块同一口径。 */
    static int estimateTokens(String s) {
        if (s == null || s.isEmpty()) return 0;
        int cjk = 0;
        int other = 0;
        for (int i = 0; i < s.length(); ) {
            int cp = s.codePointAt(i);
            i += Character.charCount(cp);
            if (isCjk(cp)) cjk++;
            else other++;
        }
        return cjk + (other + 3) / 4;
    }

    // ================= 切块 =================

    /**
     * 按 token 上限切块。优先在行边界切；单行超长时再按句末标点切。
     * 不丢任何内容：所有块按 "\n" 拼回去就是原文（首尾空白除外）。
     */
    static List<Chapter> splitBySize(String text, int maxTokens) {
        int limit = Math.max(200, maxTokens);
        String src = normalizeNewlines(text);
        List<String> blocks = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        int curTk = 0;

        String[] lines = src.split("\n", -1);
        for (String line : lines) {
            int lineTk = estimateTokens(line) + 1;
            if (lineTk > limit) {
                // 先把手上的交掉，再切这行超长的
                if (!isBlank(cur.toString())) blocks.add(trimLines(cur.toString()));
                cur.setLength(0);
                curTk = 0;
                for (String piece : splitLongLine(line, limit)) {
                    if (!isBlank(piece)) blocks.add(trimLines(piece));
                }
                continue;
            }
            if (curTk + lineTk > limit && !isBlank(cur.toString())) {
                blocks.add(trimLines(cur.toString()));
                cur.setLength(0);
                curTk = 0;
            }
            if (cur.length() > 0) cur.append('\n');
            cur.append(line);
            curTk += lineTk;
        }
        if (!isBlank(cur.toString())) blocks.add(trimLines(cur.toString()));

        List<Chapter> out = new ArrayList<>();
        for (int i = 0; i < blocks.size(); i++) out.add(new Chapter(i, blocks.get(i)));
        return out;
    }

    private static List<String> splitLongLine(String line, int limit) {
        List<String> out = new ArrayList<>();
        int tk = Math.max(1, estimateTokens(line));
        int approx = Math.max(50, (int) ((long) line.length() * limit / tk * 9 / 10));
        int pos = 0;
        while (pos < line.length()) {
            int end = Math.min(line.length(), pos + approx);
            if (end < line.length()) {
                int cut = -1;
                for (int i = end - 1; i > pos + approx / 2; i--) {
                    char c = line.charAt(i);
                    if ("。！？!?.」』”…;；".indexOf(c) >= 0) {
                        cut = i + 1;
                        break;
                    }
                }
                if (cut > pos) end = cut;
            }
            out.add(line.substring(pos, end));
            pos = end;
        }
        return out;
    }

    /** 合并、删除之后重排序号，保证界面和导出编号连续；用户改过的标题不动 */
    static void renumber(List<Chapter> list) {
        for (int i = 0; i < list.size(); i++) {
            Chapter c = list.get(i);
            c.index = i;
            if (c.rawTitle == null || c.rawTitle.isEmpty() || PART_TITLE.matcher(c.rawTitle).matches()) {
                c.rawTitle = "第" + (i + 1) + "部分";
                c.title = c.rawTitle;
            }
            c.num = String.valueOf(i + 1);
        }
    }

    static String joinSources(List<Chapter> list) {
        StringBuilder sb = new StringBuilder();
        for (Chapter c : list) {
            if (sb.length() > 0) sb.append("\n\n");
            sb.append(trimLines(c.source));
        }
        return sb.toString();
    }

    // ================= 章节正则 =================

    static final class Mark {
        int start;
        int end;
        String num;
        String unit;
        String title;
    }

    /** 找出全部章节标记。正则写错会抛 PatternSyntaxException。 */
    static List<Mark> findMarks(String text, String regex, int limit) {
        Pattern p = Pattern.compile(regex, Pattern.MULTILINE);
        Matcher m = p.matcher(text);
        List<Mark> marks = new ArrayList<>();
        while (m.find()) {
            if (m.end() == m.start()) continue;
            Mark mk = new Mark();
            mk.start = m.start();
            mk.end = m.end();
            String g1 = m.groupCount() >= 1 ? m.group(1) : null;
            String g2 = m.groupCount() >= 2 ? m.group(2) : null;
            mk.num = g1 != null ? g1.trim() : String.valueOf(marks.size() + 1);
            String matched = m.group();
            // 从匹配串里认出单位字（话/章/节/回…），不新增捕获组，用户已有的正则不用改
            Matcher u = UNIT_IN_MATCH.matcher(matched);
            mk.unit = u.find() ? u.group(1) : "";
            String title = g2 == null ? "" : g2.trim();
            int nl = title.indexOf('\n');
            if (nl >= 0) title = title.substring(0, nl).trim();
            if (title.isEmpty()) title = matched.trim();
            mk.title = title;
            marks.add(mk);
            if (limit > 0 && marks.size() >= limit) break;
        }
        return marks;
    }

    static int countMarks(String text, String regex) {
        Pattern p = Pattern.compile(regex, Pattern.MULTILINE);
        Matcher m = p.matcher(text);
        int n = 0;
        while (m.find()) {
            if (m.end() > m.start()) n++;
        }
        return n;
    }

    /** 按章节正则把整篇文本重新划分章节。一个都匹配不到返回 null。 */
    static List<Chapter> splitByChapterRegex(String text, String regex) {
        String src = normalizeNewlines(text);
        List<Mark> marks = findMarks(src, regex, 0);
        if (marks.isEmpty()) return null;
        List<Chapter> out = new ArrayList<>();
        String preface = trimLines(src.substring(0, marks.get(0).start));
        if (!isBlank(preface)) {
            Chapter c = new Chapter();
            c.num = "";
            c.rawTitle = "前言";
            c.title = "前言";
            c.source = preface;
            out.add(c);
        }
        for (int i = 0; i < marks.size(); i++) {
            Mark mk = marks.get(i);
            int bodyEnd = i + 1 < marks.size() ? marks.get(i + 1).start : src.length();
            Chapter c = new Chapter();
            c.num = mk.num;
            c.unit = mk.unit;
            c.rawTitle = mk.title;
            c.title = mk.title;
            c.source = trimLines(src.substring(Math.min(mk.end, bodyEnd), bodyEnd));
            out.add(c);
        }
        for (int i = 0; i < out.size(); i++) out.get(i).index = i;
        return out;
    }

    // ================= 中文数字 =================

    static int cnNumToInt(String s) {
        if (s == null) return -1;
        String t = s.trim();
        if (t.isEmpty()) return -1;
        StringBuilder digits = new StringBuilder();
        boolean allDigits = true;
        for (int i = 0; i < t.length(); i++) {
            char c = t.charAt(i);
            if (c >= '0' && c <= '9') digits.append(c);
            else if (c >= '０' && c <= '９') digits.append((char) ('0' + (c - '０')));
            else {
                allDigits = false;
                break;
            }
        }
        if (allDigits) {
            try {
                return Integer.parseInt(digits.toString());
            } catch (NumberFormatException e) {
                return -1;
            }
        }
        int total = 0;
        int section = 0;
        int number = 0;
        boolean any = false;
        for (int i = 0; i < t.length(); i++) {
            char c = t.charAt(i);
            int d = cnDigit(c);
            if (d >= 0) {
                number = d;
                any = true;
                continue;
            }
            int unit;
            switch (c) {
                case '十': case '拾': unit = 10; break;
                case '百': case '佰': unit = 100; break;
                case '千': case '仟': unit = 1000; break;
                case '万': unit = 10000; break;
                default: return -1;
            }
            any = true;
            if (unit == 10000) {
                section = (section + number) * unit;
                total += section;
                section = 0;
            } else {
                if (number == 0 && unit == 10) number = 1; // 「十二」= 12
                section += number * unit;
            }
            number = 0;
        }
        return any ? total + section + number : -1;
    }

    private static int cnDigit(char c) {
        switch (c) {
            case '零': case '〇': return 0;
            case '一': case '壹': return 1;
            case '二': case '两': case '贰': return 2;
            case '三': case '叁': return 3;
            case '四': case '肆': return 4;
            case '五': case '伍': return 5;
            case '六': case '陆': return 6;
            case '七': case '柒': return 7;
            case '八': case '捌': return 8;
            case '九': case '玖': return 9;
            default: return -1;
        }
    }

    static String intToCn(int n) {
        if (n <= 0 || n >= 100000) return String.valueOf(n);
        String[] d = {"零", "一", "二", "三", "四", "五", "六", "七", "八", "九"};
        if (n < 10) return d[n];
        if (n < 20) return "十" + (n % 10 == 0 ? "" : d[n % 10]);
        int[] units = {10000, 1000, 100, 10, 1};
        String[] names = {"万", "千", "百", "十", ""};
        StringBuilder sb = new StringBuilder();
        boolean zero = false;
        boolean started = false;
        for (int i = 0; i < units.length; i++) {
            int v = n / units[i] % 10;
            if (v == 0) {
                if (started) zero = true;
                continue;
            }
            if (zero) {
                sb.append("零");
                zero = false;
            }
            sb.append(d[v]).append(names[i]);
            started = true;
        }
        return sb.toString();
    }

    /** 导出时的章节标题：原文写「章」就还它「章」，写「话」就还「话」 */
    static String displayTitle(String num, String unit, String title, int fallbackIndex, String format) {
        String t = title == null ? "" : title.trim();
        if (num == null || num.isEmpty()) return t.isEmpty() ? "第" + (fallbackIndex + 1) + "章" : t;
        int n = cnNumToInt(num);
        String numText = num;
        if ("chinese".equals(format) && n > 0) numText = intToCn(n);
        else if ("arabic".equals(format) && n > 0) numText = String.valueOf(n);
        // 标题里已经带「第X章」就直接用，避免出现「第1章 第1章 相遇」
        if (t.matches("^第.{1,10}[" + CHAPTER_UNITS + "].*")) return t;
        String u = unit == null || unit.isEmpty() ? "话" : unit;
        return ("第" + numText + u + " " + t).trim();
    }

    // ================= 编码识别 =================

    static final class Decoded {
        final String text;
        final String encoding;

        Decoded(String text, String encoding) {
            this.text = text;
            this.encoding = encoding;
        }
    }

    /** BOM 优先；否则严格按 UTF-8 解，解不动就当 GB18030（GBK 的超集，国内 TXT 绝大多数是它） */
    static Decoded decode(byte[] b) {
        if (b.length >= 3 && (b[0] & 0xFF) == 0xEF && (b[1] & 0xFF) == 0xBB && (b[2] & 0xFF) == 0xBF) {
            return new Decoded(new String(b, 3, b.length - 3, StandardCharsets.UTF_8), "UTF-8 BOM");
        }
        if (b.length >= 2 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xFE) {
            return new Decoded(new String(b, 2, b.length - 2, StandardCharsets.UTF_16LE), "UTF-16LE");
        }
        if (b.length >= 2 && (b[0] & 0xFF) == 0xFE && (b[1] & 0xFF) == 0xFF) {
            return new Decoded(new String(b, 2, b.length - 2, StandardCharsets.UTF_16BE), "UTF-16BE");
        }
        CharsetDecoder dec = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        try {
            return new Decoded(dec.decode(ByteBuffer.wrap(b)).toString(), "UTF-8");
        } catch (CharacterCodingException e) {
            try {
                return new Decoded(new String(b, Charset.forName("GB18030")), "GB18030");
            } catch (Exception e2) {
                return new Decoded(new String(b, StandardCharsets.UTF_8), "UTF-8(有乱码)");
            }
        }
    }
}
