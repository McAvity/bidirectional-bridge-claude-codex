# F-W19 — punkt wznowienia

2026-10-28: feature-design, bez implementacji. Baza bba155d; branch
`design/workflow-versioning`. Zgoda użytkownika dotyczy zaprojektowania opisanego
kierunku. Zapisano brief z AC-01…10 i zagadnieniami do sprawdzenia przez planera.
Nie utworzono tasków, indeksu, decyzji o wykonaniu ani featura w bazie bridge’a.
Nie zmieniono kodu, skilli, pakietów, runtime’ów ani profili użytkownika.

Weryfikacja: odczyt bieżącego generatora, wyboru źródła instrukcji i przekazania
pakietów wykonawcy. Kontrola odsyłaczy:235 plików PASS; git diff --check PASS.
Nie wykonano testów produktu ani pilotów modeli; brief nie deklaruje spełnienia AC.

Następny krok: feature-plan dla F-W19, następnie review planu i decyzja o wykonaniu.

## 2026-11-05 — feature-flow, plan gotowy do niezależnego review

Zlecenie użytkownika `$feature-flow F-W19` deleguje przygotowanie, niezależne
review i lokalne commity; wykonanie czeka na Gate 1. Baza 417ddc2.
Izolowany branch plan/workflow-versioning; bieżący checkout/runtime nietknięty.
Plan w design.md, implementacja W19-01…06 pending. W19-P01 obejmuje tylko tę
przygotowawczą pracę (brak eligible general task i Yumi CLI; fallback repo).
Nie utworzono bridge featura ani workerów implementacyjnych. Techniczny root
niezależnego review jest osobny i nie jest upoważnieniem do implementacji.

Ryzyko: faktyczne przeładowanie nowego wydania w zachowanej sesji wymaga prób
klientów W19-01 i pilota W19-06. Nie ma jeszcze wyników tych prób. Defekty według
wpływu, jeden rejestr review, bez osobnej pętli dla każdego drobiazgu.

Następne: commit planu → niezależne review → ewentualne delegowane poprawki planu
→ proposed decision obejmująca całość i budżet pilota → pytanie Gate 1. Bez kodu,
push/merge/release/upgrade i bez uruchamiania pilota przed zgodą.
