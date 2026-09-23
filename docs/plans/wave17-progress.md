# Wave17 — postęp

## 2026-09-19 — brief i plan

Użytkownik zlecił feature-design i feature-plan dla osobnej dystrybucji workflowu.
Sprawdzono generator, oba marketplace, ścieżki instrukcji runtime, przekazanie
plugin-dir do Claude'a, istniejące testy dystrybucji i konwencję work-items.
Baza: `1d7f93bd766cdeb7fc8be517f4caf30c70738962`. Brak kolizji ID; Yumi CLI nie znaleziono.

Zapisano brief, design z hashem wejścia, feature.json i W17-01…04. Projekt uwzględnia
samodzielne użycie i runtime pin, kolizje legacy pluginu, wspólny generator oraz
zależność pakowania od finalnego wave16. Szczegóły hostów ma zweryfikować W17-01.

Walidacja planu: odsyłacze dokumentacji, indeks/ścieżki tasków, hash briefu i diff.
Nie uruchamiano testów produktu ani nowych prób hostów/modeli dla dokumentów.
Nie zmieniono źródeł skilli/pluginów, runtime, bazy lub profili. Bez push.

Następny krok: [feature-review planu](../features/F-W17-workflow-plugin/design.md),
potem feature-decide. Review i decyzja nie zostały jeszcze wykonane; implementacja
niezlecona. Nie przejmować ani nie zmieniać zakresu wave16.

## Checkpoint integracji planu

Plan zapisano w `96566f2` na branchu wave17-plan. Kontrole dokumentacji i indeksu PASS.
Próba fast-forward do feature-workflow została odrzucona: w głównym checkoucie
pojawiła się równoległa integracja dokumentów wave15 z konfliktem docs/HANDOFF.md.
Nie zmieniano ani nie rozwiązywano tej cudzej pracy. Plan pozostaje na wave17-plan;
po zakończeniu tamtej integracji dołączyć ten branch, zachowując oba checkpointy
HANDOFF, i skierować wave17 do review. Bez push lub implementacji.

## Integracja planu — 2026-09-19

Na jawne zlecenie użytkownika rozwiązano konflikt historycznych odbiorów wave15
z akceptacją planu wave16 (merge `630769a`), następnie dołączono branch wave17-plan.
W HANDOFF zachowano wszystkie trzy aktualne wpisy; poprzedni checkpoint oczekiwania
na integrację jest historyczny. Kod, skille, pin i runtime bez zmian.
Odsyłacze dokumentacji i diff: PASS. Następny krok: review planu wave17; bez push.

## Aktualizacja po integracji wave16 — 2026-09-19

Na zlecenie użytkownika zaktualizowano projekt, istniejące W17-01–04 i indeks.
Wejście: HEAD33d6061, techniczny odbiór907c59f, dostawa4c8cd88 i decyzja02 wave16.
Zależność od integracji wave16 spełniona; brief i AC-01…08 bez zmiany znaczenia.

Przeniesione ustalenia: kanoniczny local-delivery.md i DELIVERY=local-v1, brak
produkcyjnego receipt helpera, poprawka R02-01 (--no-renames/-z i historia ledgerów),
PARTIAL/blocker oraz klasyfikacja dirt, zachowanie starych kontraktów ZIP i pinu.
Bridge-upgrade/instalator już istnieją w obu pluginach bridge'a i pozostają tam.
Pakowanie musi odróżniać źródła po wave16 od wydanego runtime 0.3.2 sprzed wave16.

Zachowano wcześniejsze dowody: brak modelowego smoke nowej procedury nie staje się
PASS przez aktualizację planu. Nie dodano nowych zadań, API ani bramek odbioru.
Walidacja dokumentacji, indeksu/ścieżek, hasha briefu i diff; bez testów produktu,
zmian kodu/skilli, runtime, publikacji lub implementacji wave17.
Następny krok: feature-review planu wave17, potem feature-decide.

Walidacja aktualizacji: `git diff --check` bez uwag; odsyłacze dokumentacji bez nowych błędów. Pełna kontrola dokumentów pozostaje FAIL z powodu dwóch zastanych ścieżek absolutnych w wave16 (`execution/W16-01/01.md:57` i `wave16-progress.md:113`); historycznych dowodów nie zmieniano.

## Execution authorized — 2026-09-22

Actual worktree resolved: wave17, branch wave17; clean input fa08f1d.
Plan review01 PASS, decision01 records whole W17-01–04 authority and boundaries.
Final wave16 is present; runtime0.3.2-34ecb8d45465 remains unchanged and requires ZIP
round handoffs. New standalone product still carries wave16 local-v1 resources.
Bridge root bootstrapped successfully; Codex0.155.1 warning is advisory, identity enforced.
Shell sandbox bwrap could not start; authorized reads used escalated execution.
Next: Claude W17-01, local contract review, then remaining authorized tasks.
No product test or host/model behavioural PASS claimed yet. Local commits only.

## W17-01 delivery and contract review — 2026-09-22

Manager authorization checkpoint a67aee7; Claude contract/probes bcb2ad8, ledger92770a4.
Package verified, seven-path endpoint/history scope and clean tree PASS. Reported model-free
host evidence:26 findings, Claude2.1.280/Codex0.155.1; fixture30 and distribution15 PASS.
Independent review02 REWORK: R02-01 reproduces package-location shortcut overriding a
valid project pin. Correct contract/prototype locally, then release W17-02–04. No scope
change or new user gate; runtime untouched. Historical link failures remain separate.

## W17-01 gate passed — 2026-09-22

Fix340aefa/evidence0afbbbd/ledger a943866. Review02 appended PASS, R02-01 resolved.
Independent36 fixture tests, exact package, ancestry/every-commit scope and clean tree PASS.
No earlier evidence rewritten. Next: one sequential W17-02–04 implementation workstream,
actual generated-package/launcher checks, full required validation and independent review.

## W17-02–04 delivered; independent review — 2026-09-22

Code08cefbe/606d64b, integration tests d533651, host evidence4ec57ca, docs2115018;
report/ledgers fa88ba5 and formatting follow-ups through4038b85. Package/scope/history PASS.
Executor full checks: ci/build, JS590/Python100/pilot140/probe37/packages PASS.
Independent: targeted JS15, Python50, probes37, packages, receipt/diff PASS; canonical docs
checker still exactly two historical wave16 findings. Review03: documentation-only REWORK
R03-01 (standalone exception wording) and nonblocking R03-N1 (checker provenance).
No open code blocker. Next: bounded docs correction and final local delivery; no model pilot.

## Local delivery — independent technical PASS — 2026-09-22

Final executor deliveryfcba1e2; review03 closes R03-01 and R03-N1. No open required finding.
W17-01–04 done locally on wave17. Four Claude rounds in the same bridge session; Codex
independently reviewed contract, implementation and corrections. No unresolved recurring
finding; no step-back/product-scope decision needed. Earlier REWORK checkpoints are historical.

Full required checks: npm ci/build, JS590/Python100(no skips)/pilot140/probe37/packages PASS.
Independent final product review: JS15/Python50/probe37/packages, all round receipts,
ancestry/every-commit scope and diff PASS. Final documentation correction has no code drift.
Canonical doc checker still exit1: exactly two historical wave16 findings, no new error.
Project pin/entry/release unchanged; runtime0.3.2-34ecb8d45465 reports ready/ok.

[Handoff](../features/F-W17-workflow-plugin/handoff.md) contains AC evidence, commits,
limitations and resume. No model inference pilots; model routing/compliance and no-ZIP
model path remain UNVERIFIED. No push, merge, publication, deployment or runtime switch.
Next: user acceptance q-01, then record actual decision and close feature/root only if accepted.

## External coordinator review — 2026-09-23

Independent review04 of integrated delivery038359d: PASS, no new required correction.
Rerun: workflow packages14, selector probes37, launcher/runner8, package generation
and diff PASS. Docs gate retains exactly two historical wave16 findings. Full suites
remain prior evidence; no model smoke or behavioural PASS added. Review stored on
review/wave17-coordinator; user acceptance/integration/release remain next steps.

## User acceptance and release preparation — 2026-09-23

After coordinator review PASS, user instructed “merge i opublikuj nowa wewrsje”.
This authorizes local delivery acceptance, integration and publication to the existing
McAvity fork. Release0.4.0 includes wave16 and wave17. Runtime activation remains separate.
Two baseline documentation lines were normalized for CI: a personal dependency path
now uses a checkout placeholder; slash-separated prose no longer triggers the path rule.
Original historical content remains in Git. No model smoke or new behavioural PASS.
