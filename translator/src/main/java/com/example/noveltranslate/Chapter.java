package com.example.noveltranslate;

/**
 * 一个记忆块（按长度切出来的一段原文）。
 *
 * 字段名和网页版任务 json 完全一致，两边导出的任务可以互相导入。
 */
final class Chapter {
    static final String PENDING = "pending";
    static final String RUNNING = "running";
    static final String DONE = "done";
    static final String FAILED = "failed";

    int index;
    String num = "";
    String unit = "";
    String rawTitle = "";
    String title = "";
    volatile String source = "";
    volatile String translated = "";
    volatile String status = PENDING;
    volatile String error = "";

    // token 数缓存：估算要扫全文，列表每次重绘都算一遍会卡；原文长度变了才重算
    private int tk = -1;
    private int tkLen = -1;

    Chapter() {}

    Chapter(int index, String source) {
        this.index = index;
        this.num = String.valueOf(index + 1);
        this.rawTitle = "第" + (index + 1) + "部分";
        this.title = this.rawTitle;
        this.source = source == null ? "" : source;
    }

    int tokens() {
        String s = source;
        int len = s == null ? 0 : s.length();
        if (len != tkLen) {
            tk = TextUtil.estimateTokens(s);
            tkLen = len;
        }
        return tk;
    }

    boolean isDone() {
        return DONE.equals(status) && translated != null && !TextUtil.isBlank(translated);
    }

    void resetTranslation() {
        translated = "";
        status = PENDING;
        error = "";
    }
}
