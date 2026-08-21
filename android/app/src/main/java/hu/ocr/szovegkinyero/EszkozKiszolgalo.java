package hu.ocr.szovegkinyero;

import android.content.res.AssetManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * A webalkalmazás kiszolgálása az APK assets könyvtárából, egy kitalált
 * https:// cím alatt.
 * <p>
 * Miért nem elég a {@code file:///android_asset/}? Mert a böngészőmotor a
 * fájlrendszerről betöltött oldalnak nem engedélyezi a WebAssembly-modulok és
 * a háttérszálak (worker) betöltését – pontosan úgy, ahogy az asztali
 * változatnál sem működik a duplakattintásos megnyitás. Egy valódi https
 * eredet viszont teljes értékű: onnan minden működik, és mivel a kéréseket itt
 * fogjuk el, hálózati forgalom sem keletkezik.
 */
final class EszkozKiszolgalo {

    /** Az alkalmazás saját, kitalált eredete. Nem létező, valódi tartomány. */
    static final String EREDET = "https://ocr.helyi";

    private static final String GYOKER = "web";

    private static final Map<String, String> TIPUSOK = new HashMap<>();

    static {
        TIPUSOK.put("html", "text/html");
        TIPUSOK.put("css", "text/css");
        TIPUSOK.put("js", "text/javascript");
        TIPUSOK.put("mjs", "text/javascript");
        TIPUSOK.put("json", "application/json");
        TIPUSOK.put("wasm", "application/wasm");
        TIPUSOK.put("gz", "application/gzip");
        TIPUSOK.put("traineddata", "application/octet-stream");
        TIPUSOK.put("bcmap", "application/octet-stream");
        TIPUSOK.put("pfb", "application/octet-stream");
        TIPUSOK.put("ttf", "font/ttf");
        TIPUSOK.put("png", "image/png");
        TIPUSOK.put("jpg", "image/jpeg");
        TIPUSOK.put("jpeg", "image/jpeg");
        TIPUSOK.put("svg", "image/svg+xml");
        TIPUSOK.put("ico", "image/x-icon");
        TIPUSOK.put("md", "text/markdown");
        TIPUSOK.put("txt", "text/plain");
    }

    private final AssetManager eszkozok;

    EszkozKiszolgalo(AssetManager eszkozok) {
        this.eszkozok = eszkozok;
    }

    /**
     * @return a kért fájl az APK-ból, vagy {@code null}, ha a kérés nem
     *         hozzánk szól (ilyenkor a motor a szokásos módon járna el – de
     *         internet-engedély híján egyszerűen elbukik).
     */
    WebResourceResponse valasz(WebResourceRequest keres) {
        if (keres.getUrl() == null) {
            return null;
        }

        String cim = keres.getUrl().toString();
        if (!cim.startsWith(EREDET + "/")) {
            return null;
        }

        String utvonal = keres.getUrl().getPath();
        if (utvonal == null || utvonal.isEmpty() || utvonal.equals("/")) {
            utvonal = "/index.html";
        }

        /* Kilépés az assets könyvtárból nem megengedett. */
        if (utvonal.contains("..")) {
            return hiba(403, "Tiltott");
        }

        String eszkoz = GYOKER + utvonal;

        try {
            InputStream folyam = eszkozok.open(eszkoz, AssetManager.ACCESS_STREAMING);
            Map<String, String> fejlecek = new HashMap<>();
            /* Saját eredetből szolgálunk ki, de a webalkalmazás így is
               ugyanazokkal a szabályokkal fut, mint a böngészőben. */
            fejlecek.put("Cache-Control", "no-cache");

            String tipus = tipus(utvonal);
            String kodolas = tipus.startsWith("text/") || tipus.endsWith("json") ? "utf-8" : null;

            return new WebResourceResponse(tipus, kodolas, 200, "OK", fejlecek, folyam);
        } catch (IOException e) {
            return hiba(404, "Nincs ilyen fájl");
        }
    }

    private static String tipus(String utvonal) {
        int pont = utvonal.lastIndexOf('.');
        if (pont < 0) {
            return "application/octet-stream";
        }
        String kiterjesztes = utvonal.substring(pont + 1).toLowerCase(Locale.ROOT);
        String tipus = TIPUSOK.get(kiterjesztes);
        return tipus != null ? tipus : "application/octet-stream";
    }

    private static WebResourceResponse hiba(int kod, String uzenet) {
        return new WebResourceResponse(
                "text/plain",
                "utf-8",
                kod,
                uzenet,
                Collections.<String, String>emptyMap(),
                null);
    }
}
