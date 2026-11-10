# F-W21 — niezależne review planu 01

Werdykt: **PASS** dla planu na `c7268e53138ed31c80748ec06815d84874678bb7`.
Plan spełnia zamiar szybkiego MVP: instrukcje, dwa małe formaty i rzeczywista pętla,
bez nowego runtime'u, bazy, lease'ów czy pełnego adaptera. Brak blockerów planu.
Kanał zewnętrzny manager → worker → events ma podstawę w przypiętym kodzie hcom.
Dwie nieblokujące uwagi doprecyzowują start i odczyt zdarzeń; nie wymagają nowego kodu.
Następny krok: koordynator rozlicza uwagi i przygotowuje Gate 1 dla całego zakresu.
To nie jest zgoda na wykonanie ani potwierdzenie działania hcom na tym hoście.

## Zakres, niezależność i wejścia

Data: 2026-11-10. Reviewer: niezależny natywny agent `review_f_w21_plan`, który nie
pisał briefu ani planu. Przegląd `plan`, zlecony przez koordynatora w ramach
wywołanego przez użytkownika feature-flow. Wgląd do historii koordynatora ujawniony;
ustalenia o działaniu hcom sprawdzono bezpośrednio w źródłach.

INSTRUCTIONS=runtime:0.6.2-771e797a73d3 SET=5961e6804bdde8fba699388c2206a90e7e6ecf880919650946812c2cf784bb74

Przeczytano wybrany feature-review/SKILL.md i wspólny przewodnik tego runtime'u,
AGENTS.md, bieżący handoff, początek wave7, brief/design/index oraz W21-01/W21-02.
Wejścia repo: dokładny commit wskazany w werdykcie. SHA-256:

- brief.md: `73a087e4635e382a8be6f43c9c83dd52fc02244306db65fe408b10f46788f875`
- design.md: `9caa17f919b47d2724676a46ea13f2eb4a3bce285cafc888baa6ee6ada16e1a5`
- feature.json: `ffdb8005c7fba9557210a441b63fab959a1812b3698d75be67026242b504ff40`

hcom: lokalny klon przy `de33e31a0cdbba4c5863f7cc050d8b79aa50bcdf`, zgodny z briefem.
Punktowo czytane src/commands/send.rs, events.rs, list.rs, launch.rs, router.rs
oraz odniesienia w hooks/runtime.rs i launcher.rs. Nie instalowano ani nie uruchamiano
hcom; brak testu z modelami. Brak mutacji MCP, który jest związany z obcym worktree.

## Weryfikacja wykonalności i zakresu

- `send.rs:914–928` rozpoznaje zewnętrznego nadawcę osobno od zarejestrowanej sesji.
  `-b` prowadzi do external identity, więc manager nie musi mieć własnego procesu hcom.
- `send.rs:387–480` buduje i zapisuje zdarzenie message niezależnie od liczby
  odbiorców. Brak drugiego zarejestrowanego agenta nie gubi broadcastu w bazie.
  `send.rs:225–230` opisuje właśnie wysyłkę bez innych aktywnych agentów.
- `events.rs:1197` dopuszcza query bez instance identity; `events_wait` wyraźnie
  obsługuje anonimowy odczyt przez polling. Filtr from odnosi się do wiadomości
  wykonawcy; odczyt nie wymaga dopisywania własnej integracji lub czytania SQLite.
- `list.rs:380–405` zwraca `session_id`, `directory`, pełną i bazową nazwę w JSON.
  Plan słusznie wymaga natywnego session_id, a nie samej nazwy hcom, przed korektą.
- Odbiór sprawdza task/rundę/raport/diff/test i jest odrębny od idle/complete;
  dokładnie odpowiada minimalnym obwarowaniom briefu, bez obietnicy exactly-once.
- W21-01 → W21-02 to właściwa zależność, bez fikcyjnej równoległości. Własność
  dokumentów, koordynacji i review jest określona. Instrukcje nie zmieniają Bridge'a.
- Hipoteza, syntetyczny materiał, wersja hcom, metryki interwencji, ograniczenia
  wnioskowania i budżet (2 próby / 4 zlecenia / 45 minut, 10 minut na rundę) są jawne.
  Istniejące logowania nie są przedstawione jako zerowy koszt. Negatywny wynik
  nie uprawnia do akceptacji produktu; kolejne prace zależą od realnych problemów.

## Uwagi nieblokujące

### R01-N01 — ujednoznacznić pierwsze zlecenie i liczenie wejść modelowych

Wymaganie: minimalna pętla bez przypadkowego duplikowania pracy, zapisane powiązanie
sesji i skończony budżet (brief AC-01/03/04; design §2 i §5).
Obserwacja: §2 opisuje zlecanie przez send -b, a następnie start z odniesieniem do
pierwszego kontraktu. Czytelnik może potraktować prompt startowy i send jako dwa
polecenia wykonania tej samej pierwszej rundy. Nie jest to wymagane przez plan,
ale gotowa instrukcja W21-01 powinna wskazać dokładnie jedną ścieżkę.
Dowód: design §2; hcom launch.rs przekazuje initial_prompt do launchera, a send
jest osobnym zdarzeniem wiadomości, nie deduplikacją promptu.
Rekomendacja: najprościej start bez promptu zadaniowego, odczyt i kontrola sesji,
potem pojedynczy send z worker.md/kontraktem; albo jawnie uznać launch prompt za
pierwsze zlecenie i nie powtarzać go przez send. Każdy zadaniowy prompt, również
startowy, liczyć do limitu czterech. To doprecyzowanie instrukcji, nie nowy mechanizm.
Dyspozycja: nieblokująca uwaga do W21-01; do rozliczenia przez koordynatora.

### R01-N02 — odczytać historię przed i po ograniczonym oczekiwaniu

Wymaganie: koordynator odbiera powiadomienie i nie myli timeoutu z brakiem wyniku
(brief AC-01/04; design §2).
Obserwacja: `events_wait` w events.rs:994–1054 sprawdza tylko ostatnie 10 sekund,
a później zdarzenia po bieżącym last_id. Oczekiwanie uruchomione po dłuższej przerwie
może pominąć już zapisany wynik. Plan przewiduje kontrolę taska/rundy i odczyt zdarzeń,
ale nie mówi jeszcze, jak łączyć query z wait.
Rekomendacja: w W21-01 opisać krótki odczyt zapisanych message/from, wybór aktualnego
task_id/rundy oraz ponowny odczyt historii po timeout. Nie opierać procedury wyłącznie
na events --wait. Wymaga to tylko kolejności istniejących komend, bez własnego brokera,
subskrypcji, pełnej idempotencji czy nowego komponentu.
Dyspozycja: nieblokująca uwaga do W21-01; do rozliczenia przez koordynatora.

## Pokrycie i rzeczywiste kontrole review

Pokrycie planem: AC-01/03 → W21-02; AC-02/04 → W21-01 i zastosowanie w W21-02;
AC-05 → raport W21-02; AC-06 → zakres opt-in, diff i niezależne review. Pokrycie
jest kompletne; wszystkie produktowe kryteria nadal wymagają wykonania/dowodów.

- HEAD i hash briefu zgodne z przekazanym zakresem; worktree przed review czysty.
- Parsowanie feature.json oraz istnienie wszystkich zarejestrowanych ścieżek: PASS.
- Dokumentacja: 281 plików, brak zerwanych linków i ścieżek absolutnych: PASS.
- git diff --check: PASS.
- Odczyt kodu hcom potwierdza wykonalność przyjętych prymitywów, nie ich zgodność
  z aktualnym zestawem klientów użytkownika. Ten dowód ma dostarczyć pilot.

Nie uruchamiano testów runtime'u dla planu dokumentacyjnego. Nie stwierdzono
wykonania celu produktu: AC-01/03 są obecnie unverified, a Gate 1 pozostaje otwarta.
