package com.example.noveltranslate;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * 导出 TXT / EPUB。不依赖 Android。
 *
 * 正文是按长度切的，块边界和章节边界没关系，目录不能按块做。
 * 这里把译文拼回整篇，再用章节正则重新划分章节；一个都匹配不到就退回「一块一节」。
 */
final class Exporter {
    private Exporter() {}

    static final class Unit {
        String num = "";
        String unit = "";
        String title = "";
        String text = "";
    }

    static final class Units {
        final List<Unit> list = new ArrayList<>();
        String mode = "empty"; // regex | block | empty
        int blockCount;
    }

    static Units build(Settings s, List<Chapter> chapters) {
        Units u = new Units();
        List<Chapter> done = new ArrayList<>();
        for (Chapter c : chapters) if (c.isDone()) done.add(c);
        u.blockCount = done.size();
        if (done.isEmpty()) return u;

        if (s.exportSplitByRegex) {
            StringBuilder full = new StringBuilder();
            for (Chapter c : done) {
                if (full.length() > 0) full.append("\n\n");
                full.append(TextUtil.trimLines(c.translated));
            }
            List<Chapter> parts = null;
            try {
                parts = TextUtil.splitByChapterRegex(full.toString(), s.chapterRegex);
            } catch (RuntimeException e) {
                parts = null; // 正则写错了，退回按块导出
            }
            if (parts != null && !parts.isEmpty()) {
                for (Chapter p : parts) {
                    Unit x = new Unit();
                    x.num = p.num;
                    x.unit = p.unit;
                    x.title = p.title;
                    x.text = p.source;
                    u.list.add(x);
                }
                u.mode = "regex";
                return u;
            }
        }
        for (int i = 0; i < done.size(); i++) {
            Chapter c = done.get(i);
            Unit x = new Unit();
            x.num = "";
            x.title = TextUtil.isBlank(c.title) ? "第" + (i + 1) + "部分" : c.title;
            x.text = c.translated;
            u.list.add(x);
        }
        u.mode = "block";
        return u;
    }

    static String title(Settings s, Unit x, int i) {
        return TextUtil.displayTitle(x.num, x.unit, x.title, i, s.txtTitleFormat);
    }

    static String bookTitle(Settings s, String fileName) {
        if (!TextUtil.isBlank(s.bookTitle)) return s.bookTitle.trim();
        String f = fileName == null ? "" : fileName.trim();
        int dot = f.lastIndexOf('.');
        if (dot > 0) f = f.substring(0, dot);
        return f.isEmpty() ? "译文" : f + "（译）";
    }

    static void writeTxt(Settings s, String fileName, Units u, OutputStream os) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append(bookTitle(s, fileName)).append('\n');
        if (!TextUtil.isBlank(s.bookAuthor)) sb.append("作者：").append(s.bookAuthor.trim()).append('\n');
        for (int i = 0; i < u.list.size(); i++) {
            Unit x = u.list.get(i);
            sb.append('\n').append(title(s, x, i)).append("\n\n");
            sb.append(TextUtil.trimLines(x.text)).append('\n');
        }
        os.write(sb.toString().getBytes(StandardCharsets.UTF_8));
        os.flush();
    }

    static String xml(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length() + 16);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '&': b.append("&amp;"); break;
                case '<': b.append("&lt;"); break;
                case '>': b.append("&gt;"); break;
                case '"': b.append("&quot;"); break;
                default:
                    // XML 1.0 不允许大部分控制字符，混进来阅读器会直接打不开
                    if (c < 0x20 && c != '\n' && c != '\t' && c != '\r') continue;
                    b.append(c);
            }
        }
        return b.toString();
    }

    private static void put(ZipOutputStream zip, String name, String content) throws IOException {
        zip.putNextEntry(new ZipEntry(name));
        zip.write(content.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    /**
     * EPUB 3（附带 toc.ncx 兼容老阅读器）。
     * mimetype 必须是第一个文件且不压缩，这是规范硬要求，漏了很多阅读器直接不认。
     */
    static void writeEpub(Settings s, String fileName, Units u, OutputStream os) throws IOException {
        String title = bookTitle(s, fileName);
        String author = TextUtil.isBlank(s.bookAuthor) ? "佚名" : s.bookAuthor.trim();
        String uuid = "urn:uuid:" + UUID.randomUUID();

        ZipOutputStream zip = new ZipOutputStream(os);

        byte[] mime = "application/epub+zip".getBytes(StandardCharsets.US_ASCII);
        ZipEntry me = new ZipEntry("mimetype");
        me.setMethod(ZipEntry.STORED);
        me.setSize(mime.length);
        me.setCompressedSize(mime.length);
        CRC32 crc = new CRC32();
        crc.update(mime);
        me.setCrc(crc.getValue());
        zip.putNextEntry(me);
        zip.write(mime);
        zip.closeEntry();

        zip.setMethod(ZipOutputStream.DEFLATED);
        put(zip, "META-INF/container.xml",
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                        + "<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\n"
                        + "  <rootfiles>\n"
                        + "    <rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/>\n"
                        + "  </rootfiles>\n"
                        + "</container>\n");

        put(zip, "OEBPS/style.css",
                "body{margin:0 4%;line-height:1.75;}\n"
                        + "h2{font-size:1.3em;text-align:center;margin:1.5em 0 1em;}\n"
                        + "p{text-indent:2em;margin:0 0 0.6em;}\n");

        StringBuilder manifest = new StringBuilder();
        StringBuilder spine = new StringBuilder();
        StringBuilder navList = new StringBuilder();
        StringBuilder ncxPoints = new StringBuilder();

        for (int i = 0; i < u.list.size(); i++) {
            Unit x = u.list.get(i);
            String id = String.format(Locale.ROOT, "ch%04d", i + 1);
            String href = "text/" + id + ".xhtml";
            String t = xml(title(s, x, i));

            StringBuilder body = new StringBuilder();
            for (String line : TextUtil.normalizeNewlines(x.text).split("\n")) {
                if (TextUtil.isBlank(line)) continue;
                // 段首全角缩进交给 CSS 的 text-indent，避免缩进两次
                String l = line;
                while (l.startsWith("　") || l.startsWith(" ")) l = l.substring(1);
                body.append("<p>").append(xml(l)).append("</p>\n");
            }
            put(zip, "OEBPS/" + href,
                    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                            + "<!DOCTYPE html>\n"
                            + "<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"zh-CN\" lang=\"zh-CN\">\n"
                            + "<head><meta charset=\"UTF-8\"/><title>" + t + "</title>"
                            + "<link rel=\"stylesheet\" type=\"text/css\" href=\"../style.css\"/></head>\n"
                            + "<body>\n<h2>" + t + "</h2>\n" + body + "</body>\n</html>\n");

            manifest.append("    <item id=\"").append(id).append("\" href=\"").append(href)
                    .append("\" media-type=\"application/xhtml+xml\"/>\n");
            spine.append("    <itemref idref=\"").append(id).append("\"/>\n");
            navList.append("      <li><a href=\"").append(href).append("\">").append(t).append("</a></li>\n");
            ncxPoints.append("    <navPoint id=\"np").append(i + 1).append("\" playOrder=\"").append(i + 1).append("\">")
                    .append("<navLabel><text>").append(t).append("</text></navLabel>")
                    .append("<content src=\"").append(href).append("\"/></navPoint>\n");
        }

        put(zip, "OEBPS/nav.xhtml",
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                        + "<!DOCTYPE html>\n"
                        + "<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"zh-CN\" lang=\"zh-CN\">\n"
                        + "<head><meta charset=\"UTF-8\"/><title>目录</title></head>\n"
                        + "<body>\n  <nav epub:type=\"toc\" id=\"toc\">\n    <h1>目录</h1>\n    <ol>\n"
                        + navList + "    </ol>\n  </nav>\n</body>\n</html>\n");

        put(zip, "OEBPS/toc.ncx",
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                        + "<ncx xmlns=\"http://www.daisy.org/z3986/2005/ncx/\" version=\"2005-1\">\n"
                        + "  <head><meta name=\"dtb:uid\" content=\"" + uuid + "\"/></head>\n"
                        + "  <docTitle><text>" + xml(title) + "</text></docTitle>\n"
                        + "  <navMap>\n" + ncxPoints + "  </navMap>\n</ncx>\n");

        put(zip, "OEBPS/content.opf",
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                        + "<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"bookid\" xml:lang=\"zh-CN\">\n"
                        + "  <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n"
                        + "    <dc:identifier id=\"bookid\">" + uuid + "</dc:identifier>\n"
                        + "    <dc:title>" + xml(title) + "</dc:title>\n"
                        + "    <dc:creator>" + xml(author) + "</dc:creator>\n"
                        + "    <dc:language>zh-CN</dc:language>\n"
                        + "    <meta property=\"dcterms:modified\">2026-01-01T00:00:00Z</meta>\n"
                        + "  </metadata>\n"
                        + "  <manifest>\n"
                        + "    <item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n"
                        + "    <item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>\n"
                        + "    <item id=\"css\" href=\"style.css\" media-type=\"text/css\"/>\n"
                        + manifest
                        + "  </manifest>\n"
                        + "  <spine toc=\"ncx\">\n" + spine + "  </spine>\n"
                        + "</package>\n");

        zip.finish();
        zip.flush();
    }
}
