# Wave9 — postęp

Status: GOTOWE DO REVIEW — lokalny zakres wykonany; wave9 czeka na koordynatora.
Plan: [wave9.md](wave9.md).

Własny worktree Herdr `test`, osobny branch `wave9-integration`; początkowy stan czysty.
Baza integracji: `354c051371b7e5568c4ef34237eb8fa71bf11a76` (wymagany plan obecny).
Baza źródła: `aeb92c2f35670b73aa9e204f68f3734d2ad2cc37`.
Źródło: `timeout-recovery` @ `956b1710a779ece310159025ccc8f00be4cad141`.
Oryginalny branch zachowany; bez merge jego prywatnych metadanych do nowej historii.

## Mapowanie importu

Z każdego komunikatu usunięto prywatny trailer sesji. W dokumentach rzeczywisty task ID
zastąpiono `<task-id>`, a historyczną ścieżkę maszyny — `<local-workspace>`.
Kontrola każdego pośredniego drzewa wykryła ścieżkę obecną tylko we wczesnych wersjach;
oczyszczono lokalny import przed przekazaniem (finalne drzewo kodu bez zmian). Autor, data autora,
współautorstwo, kod i licencja zachowane. Nie przepisano historii źródłowej.

| Źródło | Integracja |
| --- | --- |
| `9c18d522ec8453225b555b5e703862a4015349b6` | `69cda2b2dc3b0fea079f1db85a87eb122ecae50c` |
| `569c48ee74f8d31ba56228c0693cd56375957bf7` | `4c06e218e7903064142fb36be187fb8676c1e999` |
| `4db266cdd8b26fae10d80d67a3371b13ec71c764` | `13c753fa12047730b97d6b8293311bffbb78268c` |
| `956b1710a779ece310159025ccc8f00be4cad141` | `fa6557642b622aadff763119627fd93839b269dd` |

## Dowody i granice

Dokumenty wave7 odczytano wyłącznie przez git show z przypiętego `88d1707`:
`docs/features/F-W7-manager-isolation/PROGRESS.md` i `reviews/03-corrections.md`.
Potwierdzono treść raportu: DONE dostawy w tej samej sesji, review REWORK, feature nieprzyjęty.
Nie sprawdzano prywatnej bazy, transkryptów ani paczki. Raport recovery około 6,5 min
pochodzi z wejścia planu wave9, nie z samodzielnego pomiaru.

Bez delegacji, modeli, pilotażu, push, merge do feature-workflow i wdrożenia.
Wave7, jego baza oraz przypięty runtime pozostają nietknięte.
## Walidacja integracji

Node 24.15.0, Python 3.12.3 (nie powtarzano na Python 3.11).
`npm ci --ignore-scripts` i `npm run build`: PASS.
`npm test`: 379/379, 25 plików. Exchange: 19/19. Pilot tooling: 110/110.
Kontrola dokumentacji: PASS, 30 plików. `git diff --check`: PASS.
Kopie using-bridge obu ról identyczne; kod/testy/konfiguracje/skille zgodne ze źródłem.
Audyt każdego pośredniego drzewa oraz metadanych importu: PASS po redakcji.
MIT i historia upstream zachowane; źródłowe commity nie są przodkami importu.
Instalacja zgłasza 5 podatności (4 moderate, 1 high); zależności i lockfile bez zmian.
Testy używają atrap: brak nowego dowodu real-agent, 75/90 minut lub 200 tur.

Następny krok: koordynator przegląda `354c051..wave9-integration`, rozlicza ewentualny
równoległy drift dokumentów, po akceptacji integruje ten oczyszczony branch, publikuje
i sprawdza CI. Nie scalać oryginalnego timeout-recovery z prywatnymi metadanymi.
Raport: [wave9-report.md](wave9-report.md).
Commit integracji/statusów: `1459786b0f53ac47adb5a1ac3315853b2ce18f47`.
Końcowy commit raportu jest tipem `wave9-integration` (SHA odczytać przez
`git rev-parse wave9-integration`; raport nie zawiera własnego rekurencyjnego hasha).
