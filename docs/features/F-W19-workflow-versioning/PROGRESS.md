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

Niezależny Claude, review planu fb3e6c5: REWORK. Dwie wymagane korekty tekstu
R19-P01 (legacy/zgodność/okno przejściowe) i P02 (izolacja klientów w pilocie).
Uwagi P03…08 pozostają w tym samym rejestrze do rozliczenia jedną partią.
Brief niezmieniony; reviewer wyłącznie odczytał dokumenty/kod, bez implementacji.
Następne: delegowana decyzja korekt planu, poprawki i skupione re-review.

Decyzja01 koordynatora zatwierdza jedną partię korekt planu P01/P02 i rozlicza
wszystkie uwagi P03…08. Źródło: delegacja feature-flow, nie zgoda użytkownika
na wykonanie. Następne: feature-plan stosuje korekty → skupione review.

Korekty decyzji01 wprowadzone jedną partią: legacy workflow bez podmiany nowych
ról silnika, jawny profil zgodności, zachowanie starego featura na starym pinie,
a nowemu diagnoza upgrade; pilot tylko izolowane profile/cache/bridge-home.
Uwagi P03…08 rozliczone w decyzji i kanonicznym planie/taskach. Wymagane P01/P02
czekają na skupione niezależne potwierdzenie; nie oznaczono ich jeszcze verified.
Następne: commit tej korekty planu i jedno skupione re-review, potem Gate 1.
