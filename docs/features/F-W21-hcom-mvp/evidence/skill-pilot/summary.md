# Pilot integracji ze skillami — W21-04

Wynik: **pełna pętla nowego feature-execute przez hcom działa**. To drugi, osobny
pilot F-W21; pierwszy sprawdzał samą procedurę. Teraz wejściem był wygenerowany
skill1.1.0, zapisany transport hcom, nowy feature ze zweryfikowanym workflow.lock,
commity/ledgery local-v1 oraz trwały stan koordynatora. Odbiór zadania syntetycznego
nie jest akceptacją F-W21 przez użytkownika.

## Wersja i przebieg

Produkt94074d8, niezależny staged PASS16153b5. Bundle candidate1.1.0:
`sha256:2205a80f5109effb2596b021a4dc7738c86a9803db6fe93071f4cbf170a386eb`.
Nowy izolowany Git projekt bez Bridge pinu. Koordynator wykonał begin/resolve
standalone z wygenerowanej paczki Codex, przeczytał wybrany feature-execute
oraz wykonał jego hcom-loop. Executor otrzymał ścieżkę entry tego samego bundle
w wariancie Claude, hash kontraktu i jedną rundę; oba ledgery potwierdzają verify.
Nie użyto starego worker.md ani polecenia „przeczytaj instrukcję pilota”.

Hcom0.7.31, Claude CLI2.1.321; konto istniejące jak w pierwszym pilocie. Worker
raportował Python3.15.2 (jego shell wybierał tę wersję); koordynator powtórzył
testy na Python3.12.16. Model pola usage: claude-opus-5-5, koszt null. Nie było
nowych kluczy, zakupów, zmiany trybu uprawnień ani aktywacji w cudzym projekcie.

| Runda | Transport | Dostawa | Niezależne sprawdzenie |
| --- | --- | --- | --- |
| 1 | request6 → ready31 | 2c28139f725916c693f2cf6c5c6ef5e1bf3fda36, ledger01 | 6 PASS na git archive tego HEAD |
| 2 | request34 → ready50 | d61b20cb00a63a3e7e9daca8080ddc6c93aeca20, ledger02 | 7 PASS na git archive tego HEAD |

Zadanie: unique_words(text), whitespace split, case-sensitive deduplikacja
z zachowaniem pierwszej kolejności. Po poprawnej pierwszej rundzie koordynator
poprosił o test NBSP/em-space i opis semantyki str.split. To faktyczna poprawa
pokrycia/docstringu, nie sfabrykowany błąd funkcjonalny. Druga runda zachowała
logikę, sześć wcześniejszych testów, ledger01 i report01.

Odbiór: właściwe feature/task/round/workflow, pełne BASE/HEAD, ancestry, brak
merge, endpoint i per-commit scope, nowy ledger, czysty worktree oraz testy
z eksportu dokładnego HEAD. Pierwszy receipt=rework ze wskazaniem poprawy;
drugi=accepted po sprawdzeniu. To decyzje koordynatora, helper tylko zapisuje
stan i sprawdza podstawową korelację. Task/index zaktualizowano dopiero po
rozliczeniu rund, osobnym commitem koordynatora. Worker zakończony normalnym
/exit; osobny zapis hcom potwierdza stopped/exit:prompt_input_exit.

## Kontrolowane wznowienie

Po pierwszym send celowo nie zapisano jeszcze event_id przez sent. Nowy proces
helpera odczytał stan z prepare: brak ack, launch_permitted=false i
dispatch_permitted=false. Koordynator odczytał historię, znalazł dokładnie jeden
request6 o tym samym kontrakcie/hashu i zapisał istniejący event. Nie wysłał drugiej
wiadomości i nie uruchomił nowej sesji. Porównano natywne ID/workspace przed rundą2
oraz po niej; były identyczne.

To rzeczywisty send z kontrolowanym ponownym odczytem stanu, **nie crash/restart
całego klienta koordynatora**. Wykazuje wznowienie procedury bez resend; nie dowodzi
pełnej odporności na awarie, exactly-once ani automatycznego recovery. Negatywne
przypadki obcej sesji/workflow/rundy sprawdzają oddzielnie testy helpera.

## Metryki i ograniczenia

- W tej próbie 1 launch, 2 task prompty; łącznie F-W21 wykorzystał budżet2 prób/4 promptów.
- Jedna zgoda trust oraz13 pojedynczych zgód klienta:8 w rundzie1 i5 w rundzie2.
  Nie przełączano na auto/accept-edits. Użytkownik nie przeklejał wiadomości.
- Runda1 send14:47:46 → ready14:52:48 (~5m02s); runda2 send14:53:38 → ready14:57:02
  (~3m24s). Końcowy receipt14:57:40 UTC; od pierwszego send ~9m53s. Każda runda
  poniżej10 minut i cała nowa część poniżej30 minut. Czas obejmuje zgody/operatora;
  czasu aktywnej obsługi osobno nie zmierzono, koszt pieniężny nieznany.
- Worker raz poprawił własną komendę Git: lista plików w zmiennej powłoki nie
  rozwinęła się zgodnie z oczekiwaniem. Jawne argumenty zadziałały; bez nowego
  task promptu, interwencji w kod wykonawcy czy napraw hcom.
- Powiadomienia broadcast są czytane z historii, nie inbox Codexa. Idle/timeout
  nie były odbiorem. Domyślne zgody nadal są głównym tarciem, integracja ich nie usuwa.
- Faktyczny modelowy test dotyczy feature-execute. Routing feature-flow i zachowanie
  jego bramek sprawdzono w instrukcjach/review, bez drugiego pełnego przebiegu flow.

## Dowody i powtórzenie

[Obserwacje](observations.json) to zanonimizowane zestawienie; prywatne state/historia,
natywne ID, surowe transkrypty i źródłowe repo pozostają poza Git. Katalogi round1/2
zawierają syntetyczny kod/testy, report.json, receipt.json, contract.json i ledger.md.
Workspace/bundle w kontraktach oraz nazwa workera w ledgerach są zastąpione
placeholderami; hashe kontraktów w ledgerach dotyczą oryginałów, nie redakcji.
Ścieżki ledgera/raportu w JSON odnoszą się do oryginalnego repo; w publikowanych
snapshotach ledger jest plikiem ledger.md. Git obiekty pilota pozostają lokalnie,
więc same opublikowane SHA nie są publicznym repozytorium tych commitów.

W każdym roundN: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v`.
To powtarza sprawdzenie artefaktu, nie ponownie komunikację z modelem.

AC07: wybór hcom zapisany i utrzymany. AC08: ten sam zweryfikowany bundle oraz
commity/ledgery/reporty. AC09: realny ponowny odczyt intencji bez resend. AC10:
wygenerowane paczki, test przez skill i korekta; ograniczenia testu flow wyżej.
Końcową ocenę niezależną zapisuje [review04](../../reviews/04-skill-execution.md).
Rekomendacja: przyjąć ograniczoną integrację, zachować ręczną diagnozę niejasności
oraz zbierać dane o zgodach przy dalszym użyciu. Publikacja/instalacja to osobny krok.

## Walidacja repozytorium

[Końcowe rozliczenie](../../execution/W21-03/03.md): testy helpera, dostawy Git,
wyboru/dystrybucji workflow, build i walidatory skilli PASS. Szeroki npm i narzędzia
pilota zachowują trzy opisane ograniczenia istniejących fixture'ów na macOS; pełny
suite nie jest deklarowany jako zielony. Nie zmieniano ich w ramach integracji hcom.
