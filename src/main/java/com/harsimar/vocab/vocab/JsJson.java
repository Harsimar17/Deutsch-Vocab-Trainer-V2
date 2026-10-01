package com.harsimar.vocab.vocab;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.List;
import java.util.Map;

/**
 * Writes JSON exactly like JavaScript's JSON.stringify(value, null, 2) — the
 * format german_vocab.json has always been saved in — so a commit from Java
 * changes only the lines of the new word, not the whole file.
 */
final class JsJson {

    private JsJson() {
    }

    static String stringify(Object value) {
        StringBuilder sb = new StringBuilder();
        write(sb, value, "");
        return sb.toString();
    }

    private static void write(StringBuilder sb, Object v, String indent) {
        if (v == null) {
            sb.append("null");
        } else if (v instanceof String s) {
            quote(sb, s);
        } else if (v instanceof Boolean b) {
            sb.append(b);
        } else if (v instanceof Integer || v instanceof Long || v instanceof Short || v instanceof Byte
                || v instanceof BigInteger) {
            sb.append(v);
        } else if (v instanceof Number n) {
            sb.append(number(n));
        } else if (v instanceof Map<?, ?> m) {
            if (m.isEmpty()) {
                sb.append("{}");
                return;
            }
            String inner = indent + "  ";
            sb.append("{\n");
            boolean first = true;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (!first) {
                    sb.append(",\n");
                }
                first = false;
                sb.append(inner);
                quote(sb, String.valueOf(e.getKey()));
                sb.append(": ");
                write(sb, e.getValue(), inner);
            }
            sb.append('\n').append(indent).append('}');
        } else if (v instanceof List<?> list) {
            if (list.isEmpty()) {
                sb.append("[]");
                return;
            }
            String inner = indent + "  ";
            sb.append("[\n");
            for (int i = 0; i < list.size(); i++) {
                if (i > 0) {
                    sb.append(",\n");
                }
                sb.append(inner);
                write(sb, list.get(i), inner);
            }
            sb.append('\n').append(indent).append(']');
        } else {
            throw new IllegalArgumentException("not a JSON value: " + v.getClass().getSimpleName());
        }
    }

    /** JS prints whole numbers without ".0" and non-finite numbers as null. */
    private static String number(Number n) {
        double d = n.doubleValue();
        if (Double.isNaN(d) || Double.isInfinite(d)) {
            return "null";
        }
        if (d == Math.rint(d) && Math.abs(d) < 1e21) {
            return new BigDecimal(d).toBigInteger().toString();
        }
        return n instanceof BigDecimal bd ? bd.stripTrailingZeros().toPlainString() : Double.toString(d);
    }

    /** JSON.stringify escaping: quote, backslash, control characters; everything else raw. */
    private static void quote(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        sb.append('"');
    }
}
