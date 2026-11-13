"""Собрать игру «Удержи экономику» в один HTML-файл (без сервера форка, демо-котировки).

python scripts/balance_single_html.py <out.html>
"""
import pathlib
import sys

WEB = pathlib.Path(__file__).resolve().parent.parent / "web"
LIVE = "http://146.103.111.37:3210/"  # исходный мем Лёхи


def main() -> None:
    out = pathlib.Path(sys.argv[1])
    html = (WEB / "balance.html").read_text(encoding="utf-8")
    for name in ("engine.js", "game.js"):
        tag = f'<script src="balance/{name}"></script>'
        if tag not in html:
            raise SystemExit(f"не найден {tag}")
        js = (WEB / "balance" / name).read_text(encoding="utf-8")
        html = html.replace(tag, "<script>\n" + js.replace("</script", "<\/script") + "\n</script>")
    html = html.replace('href="./"', f'href="{LIVE}" target="_blank" rel="noopener"')
    out.write_text(html, encoding="utf-8", newline="\n")
    print(out, len(html.encode("utf-8")), "bytes")


if __name__ == "__main__":
    main()
