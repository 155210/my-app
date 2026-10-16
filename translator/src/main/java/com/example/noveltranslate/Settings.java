package com.example.noveltranslate;

import java.util.ArrayList;
import java.util.List;

/**
 * 全部设置项。字段名和网页版的配置 json 对齐，配置文件可以两边互导。
 * 这里只放数据，不碰 Android API，方便在电脑上直接跑单元测试。
 */
final class Settings {
    static final String P_OPENAI = "openai-compatible";
    static final String P_GEMINI = "gemini";
    static final String P_ANTHROPIC = "anthropic";

    static final String DEFAULT_PROMPT =
            "你是一名专业的文学翻译。请把下面的小说正文翻译成简体中文。\n"
                    + "- 忠实原文，不要删减、概括，也不要自行添加内容\n"
                    + "- 保留原文的段落划分，一段对一段\n"
                    + "- 人名、地名、专有名词前后保持统一（有术语表时严格按术语表）\n"
                    + "- 对话的语气、人物的口吻、整体文风尽量贴近原作\n"
                    + "- 拟声词、俚语按中文读者的阅读习惯意译";

    static final class Term {
        String source;
        String target;

        Term(String source, String target) {
            this.source = source;
            this.target = target;
        }
    }

    // ---- 接口 ----
    String apiProvider = P_OPENAI;
    String apiEndpoint = "";
    String apiKey = "";
    String apiModel = "";
    int apiTimeout = 120; // 无响应超时（秒）：连续这么久没收到新内容就判定卡死
    double temperature = 0.7;
    int maxTokens = 0; // 0 = 用接口默认值
    int maxRetries = 3;

    // ---- 分块与并发 ----
    boolean blockAsChapter = false;
    int chunkTokens = 4000;
    int concurrency = 3;
    int warmupChapters = 2;
    int contextPrevChars = 300;
    int contextNextChars = 200;

    // ---- 提示词与术语 ----
    String customPrompt = DEFAULT_PROMPT;
    boolean glossaryEnabled = true;
    boolean autoGlossary = true;
    final List<Term> glossary = new ArrayList<>();

    // ---- 导出 ----
    String chapterRegex = TextUtil.DEFAULT_CHAPTER_REGEX;
    boolean exportSplitByRegex = true;
    String bookTitle = "";
    String bookAuthor = "";
    String txtTitleFormat = "original"; // original | chinese | arabic

    /** 术语表的线程安全快照 */
    List<Term> glossarySnapshot() {
        synchronized (glossary) {
            return new ArrayList<>(glossary);
        }
    }

    /** 加入新术语，已存在的原文不覆盖。返回实际新增条数。 */
    int addTerms(List<Term> terms) {
        int added = 0;
        synchronized (glossary) {
            for (Term t : terms) {
                if (t.source == null || t.target == null) continue;
                String src = t.source.trim();
                String dst = t.target.trim();
                if (src.isEmpty() || dst.isEmpty() || src.equals(dst)) continue;
                boolean exists = false;
                for (Term g : glossary) {
                    if (g.source.equalsIgnoreCase(src)) {
                        exists = true;
                        break;
                    }
                }
                if (!exists) {
                    glossary.add(new Term(src, dst));
                    added++;
                }
            }
        }
        return added;
    }
}
