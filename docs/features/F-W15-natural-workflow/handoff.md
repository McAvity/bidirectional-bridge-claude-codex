# Wave15 — dostawa do odbioru

Cały zlecony zakres W15-01–04 wykonany przez Claude przez bridge; Codex przeprowadził
niezależne review i próby. Pięć rund, jedna sesja, bez recovery. Wszystkie C1-C4/I1-I8
zamknięte; [review](reviews/02-implementation.md) PASS. Odbiór użytkownika pending.

Naturalne wejście korzysta z przypiętych instrukcji managera; plugin pozostaje cienki.
Opcjonalna preferencja AGENTS ma plan/diff i bezpieczną odmowę niezgodnego targetu.
Czyste --status/--instructions działa bez uruchomienia MCP. Kontynuacja opiera się na
trwałym intent i identycznym replay; testy sprawdzają rzeczywisty control-plane.

## Rewizje i artefakty

Baza: 0e40d24b76b12bae35f141a449cc042772425260, branch/worktree wave15.
Ostatni kod: 756ada274fcba8c1ceabcebafae35159c3c7e722 (wyłącznie propozycja pinu).
Ostatni raport wykonawcy: 292cb1455ad40b8b31fedf3861c0525cf26d8b0d.
Końcowy commit koordynatora dodaje ten handoff; dokładny head dostawy znajduje się
w manifest.json paczki i odpowiedzi końcowej. Paczka: namespace tego worktree,
`~/tmp/bridge-exchange/ws_2beafb9080707086/packages/F-W15-final-01.zip`.
[Raport wykonawcy](evidence/final-report.md), [postęp](../../plans/wave15-progress.md).

## Walidacja

Node24.15.0, Python3.12.3 (instrukcje repo podają testowane3.11).

| Kontrola | Wynik / źródło |
| --- | --- |
| npm ci --ignore-scripts | PASS, koordynator |
| npm run build | PASS, wykonawca i koordynator |
| npm test | 565 PASS, 37 plików, wykonawca r05 |
| continuation/role focused | 12 PASS, koordynator |
| I8 public setup focused | 2 PASS, wykonawca |
| Python tests | 46 PASS, koordynator; retained, obszar niezmieniony |
| pilot unit tests | 140 PASS, koordynator; retained, obszar niezmieniony |
| packages:check / doc links / diff --check | PASS |
| Paczki r01–r05 | integralność/provenance/scope zweryfikowane przez koordynatora |

Niezależne próby koordynatora: WORKING orphan/no-handle bez lease, zero invoke
i niezmienione SQLite; odmowy symlink/duplicate; stary target bez statusu; I8 odmowa
bez zapisów na rzeczywistym ff225e5. Są to próby deterministyczne, nie model smoke
ani dowód śmierci/restartu prawdziwego procesu agenta. Wcześniejsze pełne JS560/1FAIL
wykryło I7; zachowane jako historia, finalne JS565 jest zielone po poprawce.

## Ograniczenia i wyłączenia

- Model smoke niezlecony i niewykonany. Zachowanie modelu w AC-01/02/07 niepotwierdzone.
  Claude rzeczywiście implementował przez bridge; brak modeli dotyczy testów.
- Intent/replay to instrukcje koordynatora, bez automatycznego wake/retry. Brak trwałego
  execution handle oznacza strict stop, bez sesji zastępczej. G3: podczas operacji
  oczekujących nie zmieniać runtime/pinu; istniejące ograniczenie callback hash.
- Capability check czyta nazwy w źródle targetu: przyszła inna implementacja może
  zostać konserwatywnie odrzucona. Stare runtime wymagają osobnej jawnej aktualizacji
  przed preferencją; już zapisane historyczne bloki nie są automatycznie naprawiane.
- Aktywny runtime ff225e550966, release pin, deklaracja projektu, konfiguracja oraz
  główny AGENTS pozostają bez zmian. Brak push, merge, wdrożenia i zmian innych worktree.

## Punkt wznowienia

Feature F-W15-natural-workflow, root task_7zykhr76zt, ostatnia runda task_8prrdyndtz DONE.
Brak aktywnego wykonawcy. Po eksporcie koordynator zadaje q-01 o odbiór lokalnej dostawy.
Czytaj feature.json, postęp i bridge_feature_get; nie odtwarzaj zakończonych rund.
Odpowiedź użytkownika zapisać przez feature-decide i bridge_feature_answer_user; dopiero
rzeczywisty odbiór pozwala feature_accept i domknąć root. Samo „kontynuuj” nie zastępuje
odpowiedzi na pytanie o odbiór. Dalszy smoke/publikacja/aktywacja wymagają osobnego zlecenia.

## Commity przed końcowym handoff

```text
895cc99 docs(wave15): record execution authority and task scope
2345b30 docs(W15-01): ground the natural-workflow design in the real bridge API
e66c6d7 docs(wave15): review design and bound entry corrections
c4483b4 feat(W15-02): natural feature requests, a portable entry read and an optional preference
55d3e5f fix(W15-02): report the runtime path without a trailing separator
dd6d971 docs(W15): correct the design for W15-C1..C4 and record both round ledgers
55ddd90 test(W15-02): cover the preference on the plugin surface users actually run
c32fe2d docs(W15-02): record the plugin-surface preference coverage in the ledger
ea7d1bd docs(W15): correct the recorded documentation-check file count
6df44ce docs(wave15): record entry findings and recovery correction scope
38dd547 wip: W15-03 and I1-I5 before the real-runtime suites
59b808e feat(W15-03): safe "continue", real-state interruption regressions, and I1-I5
02ced39 docs(W15-I1): correct the setup CLI help for the preference refusal
da6b026 docs(wave15): close entry findings and step back on continuation evidence
145b915 docs(wave15): record full-suite role-contract regression
0b563ba test(W15): close the C2, I6 and I7 evidence gaps
55cb52a docs(W15-04): record the corrected evidence, the full validation and the feature report
9cf439d docs(wave15): close evidence review and isolate old-pin preference gap
756ada2 fix(W15-I8): refuse the preference when the target runtime cannot serve its read
292cb14 docs(W15): record the I8 correction and refresh the report
```
