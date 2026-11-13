"""Доводка гайда после build.py навыка spravka-builder: слова под игру, копии в форк и WORKMODE.

python guide/finish.py   (после build.py spec.json out/guide-uderzhi-ekonomiku.html)
"""
import pathlib
import shutil

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "out" / "guide-uderzhi-ekonomiku.html"
s = SRC.read_text(encoding="utf-8")
for a, b in [
    ("раньше называлось:", "ещё говорят:"),
    ("Где…? Напиши, как ты это называл раньше: «структура подчинённости», «на основании»…",
     "Что ищешь? Например: «свесить за край», «крен», «копилка», «телефон»"),
    ("Рамка на картинке — куда нажимать.", "Рамка с номером — то, о чём шаг."),
]:
    s = s.replace(a, b)
SRC.write_text(s, encoding="utf-8", newline="\n")
shutil.copyfile(SRC, HERE.parent / "web" / "balance-guide.html")
reports = pathlib.Path("C:/Git/Workmode/runtime/reports")
if reports.exists():
    shutil.copyfile(SRC, reports / SRC.name)
print(SRC, len(s.encode("utf-8")) // 1024, "KB")
