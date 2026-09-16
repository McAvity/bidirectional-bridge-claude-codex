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
