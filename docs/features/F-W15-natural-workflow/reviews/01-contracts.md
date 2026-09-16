# W15-01 review — REWORK, 2026-09-16

Koordynator Codex, niezależny od wykonawcy Claude, uczestniczył w koordynacji.
Task task_10ehn2rfm9; zakres 895cc99..2345b30359a9102efc3262054f86def9e6c728ea.
Paczka r01 zweryfikowana: SHA256 1b18d3d48ac2a5418d07f4e7641833f50da3513fcdc1d8a17533f454b2e3f217;
2 pliki zgodne z kontraktem, czysty worktree, diff check PASS.
Projekt wymaga poniższych korekt w zleconym zakresie. Bez nowej decyzji produktowej.
W15-02 może realizować poniżej rozstrzygnięty kierunek wraz z korektą projektu;
W15-03 pozostaje po review W15-02. To nie odbiór użytkownika.

## W15-C1 — wejście w pristine worktree (blocker, AC-03)

Design §1 opiera wejście bez pluginu wyłącznie na .bridge-runtime/current.
locate.mjs klasyfikuje inherited-pristine przy braku .bridge-runtime i .bridge;
read-only start niczego nie tworzy. W nowym worktree ścieżka więc nie istnieje.
Korekta: minimalny czysty tryb status/instructions istniejącego project entry/dispatchera,
który rozwiązuje pin przed bootstrapem, zwraca ścieżki instrukcji właściwego runtime
bez zakładania current i bez nowego instalatora. Przetestować inherited-pristine,
missing runtime i pin mismatch. Preferencja AGENTS wskazuje ten przenośny odczyt.

## W15-C2 — checkpoint musi dać się zapisać i odtworzyć (blocker, AC-05)

Design §3 miesza ledger wykonawcy z zapisami managera i wymaga lease przed utworzeniem
roota, który jest potrzebny do lease. Sam hash requestu nie odtwarza argumentów.
Korekta: dokładny kontrakt/argumenty w lokalnym ignorowanym pliku intencji (przed pierwszą
mutacją), referencja i bezpieczne metadane w istniejącym ledgerze koordynatora dopiero
po uzyskaniu własności/lease, bez zapisów do ledgera wykonawcy. Lokalny zapis intencji
nie jest konkurencyjną bazą bridge: nie orzeka o przyjęciu operacji. Jasno opisać
aktualizację identyfikatorów podczas running bez commitów lub managerowych zmian w paczce.
Nie commitować prywatnych odpowiedzi/kontraktów. Brak dokładnych danych = blokada,
nie rekonstrukcja zgadywana z hasha.

## W15-C3 — żadnego zastępczego featura (blocker, AC-05/06)

G-2 wariant c sugeruje nowy feature_id po utracie handle, sprzecznie z zakazem obejść.
Korekta: zatrzymanie z konkretną diagnozą i zachowaniem dowodów; brak handle jest
rzeczywistą granicą strict recovery, nie zgodą na nową sesję lub feature. Samo utracenie
odpowiedzi managera nie oznacza śmierci serwera/workera. Rozdzielić te przypadki w testach.
Nie implementować nowego publicznego protokołu ani operacji porzucania. Nie wymaga to
osobnej decyzji, dopóki dostawa uczciwie zachowuje granicę planu: bez obchodzenia recovery.

## W15-C4 — ścisłe rozstrzyganie i poprawne scenariusze (blocker, AC-04/05)

Root utracony przed claim nie pojawi się w list_tasks(owner=codex); objective/scope
nie jest unikalną tożsamością. Użyć identycznego create_task z utrwalonym kluczem jako
rozstrzygnięcia, bez dobierania taska po podobieństwie. Niezmieniony predecessor to
obserwacja, nie dowód braku przyjęcia przy równoległym dokończeniu żądania: tylko identyczny
replay, nigdy nowy klucz. S-05 jak S-03 (aktywny worker) odrzuci nowy klucz; duplikat
może wystąpić po DONE. S-08 dodatkowa próba bez klucza wymaga stanu recoverable,
nie DONE. Poprawić scenariusze i sprawdzić je rzeczywistym harness-em w W15-03.

Walidacja koordynatora: odczyt feature-workflow.ts, orchestrator.ts, idempotency.ts,
identity-runtime.ts, locate.mjs, entry-template.mjs i workspace.mjs; verify r01 i diff.
G-3 pozostaje ograniczeniem przy stałym runtime, bez potrzeby zmiany publicznego API.
Pierwsze review tych problemów; step-back przy trzecim.

## Review korekt — 2026-09-16, task_axt2g9bfzf, ea7d1bd

REWORK; zakres e66c6d7..ea7d1bd75e2c418c96694bb5c07cbac31cb571d5.
Paczka r02 integrity/range PASS, SHA256 5a2cd2a68ef93ac3cdb651ef8f1f2efddd5e6693a8a82d75f2c376c3a36a5ee9,
30 plików w kontrakcie, czysty worktree. Koordynator nadal niezależny od implementacji.

- C1: resolved dla pristine entry; nowy read-only entry rozwiązuje pin bez current.
  Odrębne usterki plugin status i legacy opisano w 02-implementation.
- C2: progress, wymagane domknięcie. Dokładny lokalny request i rozdział ledgerów są
  poprawne, ale .bridge/intent przed rootem blokuje bootstrap: classifyNativeState
  (workspace.mjs) traktuje katalog .bridge bez workspace.json jako unexplained;
  assertPristineStateDirectory w workspace-state.ts odmawia nieznanych plików.
  Użyć istniejącej prywatnej przestrzeni exchange danego worktree, np. osobnego
  katalogu intents obok packages, wyliczanej istniejącym namespace (czysty odczyt).
  Nie tworzyć .bridge ani .bridge-runtime przed bootstrapem, nie osłabiać guardów.
  Plik intencji ma być trwały, zapisany atomowo przed wysłaniem; brak/uszkodzenie
  oznacza blokadę. Dodać test rzeczywistego bootstrapu po zapisie intencji.
- C3: resolved. Brak handle = jawny stop; utrata odpowiedzi oddzielona od śmierci serwera.
- C4: progress. G-4 i scenariusze poprawione, ale główna tabela §4 nadal zaleca
  list_tasks(owner=codex)+objective/scope i uznaje równy predecessor za dowód braku
  rezerwacji. Usunąć sprzeczne instrukcje w miejscu, nie dopisywać kolejnego wyjątku.

To drugie review C2/C4. Przy następnym sprawdzeniu obowiązuje step-back niezależnie
od postępu. Prostszy kierunek: jeden plik intencji w istniejącej przestrzeni wymiany,
jedna kanoniczna tabela replay, żadnej nowej maszyny stanów ani zmian protokołu.

## Trzecie review C2/C4 — step-back, 2026-09-16, task_ztxwvbm7ez

Zakres 6df44ce..02ced395dc13e9f09722b8ad8707e3d040dab299; paczka r03 PASS,
SHA256 1b5da79db04dd554b5535ed8e5d5c2698fb7dfc4a0d8b3a3a835f15171b2ac16.

Step-back: celem jest odzyskać dokładne żądanie po przerwie, bez duplikacji i bez
naruszenia bootstrapu. Prostsze rozwiązanie to jeden plik intencji w istniejącej
przestrzeni exchange i istniejące replay; nie potrzeba helpera, nowej bazy ani API.
Kierunek został zachowany. Test rzeczywistego bootstrapu po zapisie poza repo oraz
odmowa zapisu do .bridge potwierdzają poprawkę lokalizacji.
C2: progress; projekt jest poprawny, lecz testy replay używają nadal f.request z pamięci
(mimo komentarza „intent file exists”). Domknąć dowód: utrwalić dokładny request
atomowo w pliku, po przerwie używać wyłącznie nowo sparsowanych argumentów, sprawdzić
key/contract/budget/task/attempt counts także po powtórnym przerwaniu. Nie dodawać
produkcyjnej maszyny stanów. To wąska poprawka testów, bez kolejnego rozwiązania.
C4: resolved; sprzeczne zalecenia usunięto z głównej tabeli. Test też skorygował
błędne wcześniejsze twierdzenie o WORKING->WORKING. Naprawić tylko brak separatora
kolumn w wierszu Root task (atomowość/odczyt), bez nowej zmiany semantycznej.

## Domknięcie C2 — task_16hy41wpzb, 55cb52a, 2026-09-16

C2 resolved. Request rundy i recovery jest zapisany atomowo i odczytywany/parsowany
ponownie po przerwie; testuje key/contract/budget i liczniki po kolejnych przerwach.
Koordynator uruchomił 12 regresji continuation/role: PASS na 0b563ba.
Step-back nie przyniósł nowej warstwy: pozostał jeden plik intencji + istniejące replay.
Wszystkie C1-C4 zamknięte; projekt techniczny PASS. Modelowe zachowanie nadal unverified.
