# Review 01 — plan F-W22

**PASS planu.** Domyślny workflow bez MCP, osobna migracja i instalacja kolejnych
wydań bez blokowania klientów odpowiadają celowi użytkownika. Brak blockerów
planowania. Dwie uwagi do kontraktu/protokołu poniżej. Następnie Gate 1;
implementacja pozostaje niezatwierdzona.

## Wejścia i niezależność

Autor: odrębny agent `/root/review_f_w22_plan`, nie autor planu. Raport przekazany
koordynatorowi do zapisu, bez zmian produktu i mutacji MCP przez reviewera.
Commit: `d097dd320c02e405db19837643449b540a0a06ad`.
Zakres: brief/design/index, W22-P01 oraz W22-01…06.
Brief SHA-256: `7e3b746399386e4404f652db432bc60fc42a45c68d8cf03454fb463c0a351a7d`.
Instrukcje: workflow `1.1.3-ca0ed85dea2a`, feature-review mode plan i shared guide.
Sprawdzone źródła: source readers, storePublish, hcom-loop, układ SQLite,
generator/manifesty i stary protokół operatora.

## R01-01 — zgodność bundle obejmuje również resolver

Dyspozycja: **uwaga nieblokująca planu**; uwzględnić w W22-01 i testach W22-02/03.
Wymagania: AC-02, AC-05, AC-07.

Design §3 zachowuje identity workflowu i wyróżnia lock bez wsparcia hcom.
Samo posiadanie hcom nie gwarantuje działania po migracji. Workflow1.1.3 zawiera
dawny resolver: `select-source.mjs:183–189` odmawia przy wyłączonej deklaracji
lub brakującym runtime, a hcom-loop wymaga normalnego resolve (§ Select instructions).
Trzeba odróżnić zachowanie historycznego locka i bajtów od możliwości kontynuacji
według tego bundle po migracji. Nie ogłaszać gotowości tylko na podstawie hcom
support. Wymagana jawna ścieżka zakończenia pracy przed migracją lub uprawniony
switch między rundami, bez edycji immutable bundle. Istniejący zakres W22-01
obejmuje tę kwestię; nie jest potrzebne rozszerzenie produktu.

## R01-02 — pilot nie wykonuje starej instrukcji MCP

Dyspozycja: **uwaga nieblokująca planu**; doprecyzować W22-06.
Wymagania: AC-01, AC-04, AC-08.

W22-06 wskazuje `tools/pilot/rework/OPERATOR.md`, którego kroki startowe używają
starego launchera i wymagają `/mcp` z Bridge. Literalne wykonanie przeczyłoby
nowej próbie. Przejąć tylko separację operator/pilot, zachowanie dowodów i limity.
Nowy protokół opisuje start, preflight i obserwację hcom bez MCP. Materiały
operatora nie trafiają do kontekstu koordynatora pilota.

## Pokrycie planu

| Kryterium | Ocena |
| --- | --- |
| AC-01 | Domyślny transport, samodzielne paczki, świeży koordynator; rzeczywisty pilot nadal wymagany. |
| AC-02–03 | Osobna migracja, read-only stan, konflikty, journal i review kontraktu. |
| AC-04–05 | Instalacja obok starej kopii, brak GC, brak legacy probes i update podczas rundy. |
| AC-06 | Instalacja oddzielona od aktywacji; reload do sprawdzenia, bez obietnicy hot reloadu. |
| AC-07 | Kontrole hcom/integralności zachowane, nie blokują dołożenia wydania. |
| AC-08 | Samodzielna dystrybucja lifecycle i dwa repo próby. |

W22-01 prawidłowo oddziela kontrakt migracji/wyścigu od jego konsumentów.
Brak gotowego kontraktu nie blokuje planu, bo jego wykonanie i niezależne review
są wymaganymi zależnościami dalszych tasków.

## Weryfikacja i ograniczenia

Reviewer sprawdził ścieżki indexu/tasków/kontekstu, hash briefu i unikalne AC-01…08;
`git diff --check d097dd3^ d097dd3` — PASS. Koordynator niezależnie sprawdził linki,
pokrycie AC w taskach i hash briefu. Nie uruchamiano testów produktu ani modeli.
Budżet dwóch koordynatorów, dwóch Claude, czterech dispatch, 15 minut/rundę i
60 minut próby jest ograniczony i wymaga Gate 1. Dry run lub wyczerpanie budżetu
nie oznaczają sukcesu produktu. Cel użytkowy pozostaje unverified; PASS dotyczy planu.
