# Q-02: źródło natywnej tożsamości Codexa

Data: 2026-09-12. Decyzja: ../decisions/05.md. Koordynator: Codex; niezależny read-only reviewer: drugi Codex, na jawne zlecenie użytkownika. To weryfikacja źródła i eksperyment protokołu, nie implementacja W7-ID-02 ani przyjęcie kontraktu/featura. Claude task task_<historical-10> i jego sesja pozostają zachowane, bez nowej próby.

## Wynik

Zachować AC-03. Codex 0.154.0 ma natywne źródło tożsamości wywołania: `params._meta.threadId`, ustawiane przez host z `sess.thread_id`, poza argumentami modelu. Nie ma go w sprawdzonym środowisku startowym stdio MCP ani w `initialize`. Dotychczasowy wniosek „brak zweryfikowanego kanału” nie uzasadnia wariantu ręcznego. Bridge obecnie gubi kontekst requestu — callback w `shared/mcp-server-core/src/server.ts:103` przyjmuje tylko args, chociaż SDK udostępnia `extra._meta`.

Pełne automatyczne przypisanie przy starcie wymaga osobnego wskazania oczekiwanego managera, a potem porównania każdego wywołania z tym przypisaniem. Nie wolno używać „pierwszy caller wygrywa”, najnowszego pliku z cwd, samej roli `codex`, PID ani wartości argumentu toola. W chwili utworzenia procesu MCP nie mamy jeszcze dowodu konkretnego thread; handshake bez mutacji może poprzedzać powiązanie, natomiast autoryzacja zapisu musi czekać na jego zakończenie.

## Pochodzenie dowodów

- Lokalna binarka: `codex-cli 0.154.0`, instalacja pakietu @openai/codex, Linux. Wykonano `pwd`, `git status --short`; worktree wave7 początkowo czysty. `bridge_server_info`: caller codex, delegation allow. To potwierdza przypiętą rolę procesu, nie dokładny natywny thread.
- Dostępny lokalnie checkout źródeł: origin odpowiada publicznemu openai/codex, czysty, tag `rust-v0.154.0`, commit `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`. Prywatnej ścieżki checkoutu nie publikujemy. Zgodna etykieta wersji nie jest dowodem reproducible build ani weryfikacją podpisu binarki; istotne zachowania dodatkowo sprawdzono na binarce.
- Źródła analizowane lokalnie, ścieżki poniżej względem tego commita:
  - `codex-rs/rmcp-client/src/utils.rs:16–58,163–175`: whitelist środowiska MCP, jawne env/env_vars; brak automatycznej injekcji thread/session ID.
  - `codex-rs/rmcp-client/src/stdio_server_launcher.rs:270–280`: env_clear, następnie ustawienie wyliczonego środowiska.
  - `codex-rs/codex-mcp/src/rmcp_client.rs:1049–1071,1136–1178`: initialize opisuje klienta i capabilities, stdio przekazuje konfigurację; brak natywnego ID.
  - `codex-rs/core/src/mcp_tool_call.rs:506–529,1184,1328–1349`: host ustawia `_meta.threadId` z aktualnego sess.thread_id. Helper nadpisuje stare pole w obiekcie. Przy metadanych innego typu pozostawia je bez uzupełnienia; odbiorca ma odrzucać brak/zły typ, nie stosować fallback do args.
  - `codex-rs/core/src/mcp_tool_call_tests.rs:1752–1791`: istniejący test nadpisania stale-thread przez thread-live, odczytany, nie uruchamiany tutaj.
  - `codex-rs/core/src/session/session.rs:761–797`: resume bierze conversation_id z historii; nowe/forkowane thread dostają nowe ID; rodzina agentów może współdzielić session_id.
  - `codex-rs/core/src/guardian/review_session.rs:875–885`: guardian startuje jako SubAgentSource::Other.
  - `codex-rs/core/src/hook_runtime.rs:128–159`: SessionStart rootowi przekazuje session_id; ThreadSpawn ma osobny SubagentStart, pozostałe SubAgent są wykluczone.
  - `codex-rs/core/src/session/session.rs:1605–1639`: MCP start/prewarm poprzedza zakolejkowanie SessionStart. Hook wykonuje się na początku tury (`session/turn.rs:287`, odczyt niezależnego reviewera).

Oficjalna [dokumentacja MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) potwierdza, że env_vars przekazuje nazwane zmienne ze środowiska Codexa, a nie generuje ID. [Dokumentacja app-server](https://learn.chatgpt.com/docs/app-server) opisuje thread/start, dokładne thread/resume i odrębny thread/fork. [Dokumentacja hooków](https://learn.chatgpt.com/docs/hooks) opisuje SessionStart startup/resume i uprzedza, że hook może wyprzedzać gotowość MCP. Semantykę szczegółowych pól wersji 0.154.0 ustalono z kodu i próby, nie tylko z dokumentacji bieżącej.

## Obserwacje i próba binarki

Odczyt /proc był ograniczony do booleanów obecności CODEX_THREAD_ID i CODEX_SESSION_ID: obie obecne w środowisku shell tool, obie nieobecne w trzech znalezionych procesach bridge MCP, w tym dwóch z przypiętego runtime. Nie odczytywano ani publikowano wartości tych ID. Nie zmieniano tych procesów. Obserwacja procesów nie identyfikuje sama konkretnego połączenia; powtarzalna próba niżej potwierdza ścieżkę startup.

Reprodukcja: `python3 docs/features/F-W7-manager-isolation/evidence/03-native-identity-probe.py`. Zainstalowany Codex app-server, osobny tymczasowy profil/stany i workspace, lokalny HTTP provider ze statycznymi odpowiedziami, syntetyczny serwer MCP. Nie otwiera produkcyjnej bazy bridge. Nie kopiuje danych logowania ani osobistych sesji. Wyniki zanonimizowane w `03-native-identity-results.json`; surowe dane testowe zostają poza repo. Test nie jest pomiarem całego ruchu sieciowego: provider modelu wskazuje localhost i nie skonfigurowano prawdziwego modelu.

Sprawdzono:

1. Dwa współistniejące root threads A i B mają różne natywne ID. Próba app-server podaje source vscode; nie jest to test interaktywnego TUI.
2. Trzy starty MCP nie dostają thread/session ID w środowisku ani w initialize; initialize zawiera capabilities/clientInfo/protocolVersion.
3. Rzeczywiste wywołania MCP niosą sekwencję `_meta.threadId` A, B, A. Trzecie następuje po zakończeniu pierwszego app-servera i resume A w nowym procesie. ID odpowiedzi resume i metadanych pozostaje dokładnie takie samo.
4. We wszystkich wywołaniach podano celowo inne ID w argumentach. Nie nadpisuje ono metadanych hosta.
5. Syntetyczna bramka porównuje metadane z plikiem bindingu wygenerowanym automatycznie z odpowiedzi własnego thread/start A. Wynik: A dopuszczony, B odrzucony, wznowiony A dopuszczony. Plik ma tryb 0600 w prywatnym katalogu tymczasowym. Użytkownik nie podaje ID ani nie przechowuje tokenu.

Pierwsza próba bez tury nie utrwaliła rollout i resume zwróciło brak historii. Następnie lokalny syntetyczny provider umożliwił utrwalenie testowego wątku. Pierwsza wersja fixture nie obsługiwała namespace narzędzi, więc nie wykazała wywołania MCP; skorygowano ją. Niezależne review wskazało utratę powiadomień i brak korelacji turn/completed; skorygowano harness przed końcowym uruchomieniem. Historycznych niepełnych prób nie przedstawiamy jako PASS.

## Gwarancje i granica zaufania

| Kanał | Co rzeczywiście dowodzi / czego nie dowodzi |
|---|---|
| Argument native_session_id/threadId | Deklaracja wywołującego; nie potwierdza tożsamości. |
| `_meta.threadId` od kontrolowanego Codexa | Dokładny thread obsługujący to wywołanie; argument modelu nie wybiera jego wartości. Nie wskazuje sam, który thread użytkownik wyznaczył managerem. |
| CODEX_SESSION_ID/root session_id | Tożsamość rodziny/root; może być wspólna z guardianem, więc nie autoryzuje pojedynczego wywołania. |
| Odpowiedź własnego app-server thread/start/resume | Host zwraca utworzony/wznowiony thread; po korelacji requestu nadaje się do automatycznego oczekiwanego bindingu. Argument resume musi zostać porównany z odpowiedzią oraz wcześniejszym bindingiem. |
| Prywatny nonce/plik/kanał launchera | Może odseparować instancje uruchomienia. Sam nie rozróżnia threadów we wspólnym procesie ani nie powstrzymuje złośliwego procesu tego samego UID. |

Przy zaufanym lokalnym Codexie, konfiguracji i transporcie stdio można chronić przed przypadkowym pomieszaniem sesji, wyborem guardiana i podaniem obcego ID w argumentach. To nie jest odporne na podszywanie uwierzytelnienie wobec procesu tego samego użytkownika, który może zmienić launcher/konfigurację, odczytać lokalny sekret lub sam wysłać JSON-RPC. Taka mocniejsza gwarancja wymaga niezależnej granicy zaufania/OS. Nie obiecujemy jej przez samo hashowanie tokenu. Proces, worktree i thread to trzy odrębne tożsamości; dwa równoczesne resume tego samego thread nadal wymagają atomowego ownership i fencing instancji.

## Zwykły Codex i minimalny launcher

Zwykły Codex ma użyteczne metadane per-call, lecz sprawdzona ścieżka nie przekazuje dokładnego thread już w chwili spawn MCP. Dodanie env_vars nie naprawia pochodzenia: może skopiować stare/rodzicielskie ID. Hook SessionStart jest kandydatem do automatycznego wskazania roota, ale trzeba jeszcze udowodnić, któremu uruchomieniu wrappera należy przekazać jego wynik. Rejestr globalny „ostatni hook w cwd” jest niedopuszczalny. Czekanie na hook wewnątrz initialize/tools-list może zablokować start; handshake ma działać bez zapisów i bez przyznawania uprawnień.

Minimalny launcher kontrolujący app-server ma deterministyczne źródło: wynik własnego thread/start/resume. Powinien tworzyć prywatny kontekst per uruchomienie, umożliwić bezstanowy handshake wrappera, związać odpowiedź hosta z oczekiwanym worktree/feature i dopiero potem dopuścić turn/mutacje. Przy resume wymaga dokładnego wcześniejszego ID; nie tworzy zastępczego thread po błędzie. Każde wywołanie musi przejść porównanie `_meta.threadId`, także gdy guardian/inna sesja korzysta ze wspólnego procesu MCP. Zamiana samej komendy MCP na wrapper nie daje launcherowi automatycznie dostępu do odpowiedzi app-server.

Eksperyment wykazuje źródło i działanie syntetycznej bramki, **nie gotowy launcher**. Binding pozostaje przez restart w prywatnym pliku; nie sprawdzono nowego nonce/kanału, atomowej ponownej rejestracji, wyścigów, fencing ani zapisów produktu. TUI/Desktop wymagałoby integracji rzeczywiście kontrolującej jego proces/endpoint; prototyp app-server nie stanowi dowodu zachowania ich UI. To ograniczenie integracji, a nie dowód niemożliwości zachowania AC-03.

## Niezależne review i następny krok

Drugi Codex niezależnie potwierdził źródło host metadata, resume, rodzinne session_id oraz kolejność MCP/hook; zaleca zachowanie AC-03. Zastrzeżenia dotyczące próby uwzględniono powyżej. Review nie zatwierdza kontraktu r2 ani featura.

Przed uznaniem automatycznego startu za spełniony pozostają: realny hook/TUI, guardian i zwykły subagent, dwa równoległe starty z odwróconą kolejnością handshake/binding, dwa równoczesne resume tego samego thread, brak/zły typ/obce metadane, fork/clear, awaria kanału i restart wrappera, atomowy fencing oraz dowód braku mutacji przed odmową. Współistniejące wątki z sekwencyjnymi turami nie są testem race. Narzędzie probe ma readOnlyHint; odmowa syntetycznej bramki nie dowodzi braku zapisów w produkcyjnym bridge.

Rekomendacja do dalszej pracy Claude’a: oprzeć korektę R03-01 na host `_meta.threadId` i automatycznym oczekiwanym bindingu; nie wdrażać ręcznego wariantu r2. Najpierw doprecyzować granicę startup/handshake/binding i wykonać powyższe próby integracji; równolegle pozostają zwykłe korekty R03-02/03. W tej turze kontrakt i kod produktu pozostają bez zmian, źródło tożsamości oraz wykonalność kandydata zostały zbadane. Nie stwierdzono niemożliwości spełnienia AC i nie zmieniono jego znaczenia.
