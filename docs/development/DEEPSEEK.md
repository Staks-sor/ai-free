# DeepSeek: инструменты и завершение работы

2026-10-08, Codex. `main/3db7d9c`; локальные незакоммиченные изменения, без публикации.

## Изменение

Скриншот пользователя показал DSML `calls/invoke/parameter` вместо выполненного `read_file`. Клиент распознавал JSON и старый XML, поэтому code loop принимал DSML за итоговый текст и останавливался.

`src/providers/deepseek/tool-call.mjs` разбирает один полный вызов DSML: `calls`/`function_calls`, Unicode/ASCII разделители, строковые и JSON-параметры. Некорректные параметры, дубликаты и несколько вызовов отклоняются. Результат поступает в существующий executor, сохраняя разрешения и проверки путей. `client.mjs` вызывает этот parser перед прежним JSON parser. Desktop/VS Code синхронизированы.

Второй скриншот показал чтение восьми файлов/каталогов и обещание «I'll implement / let me start», ошибочно принятое за завершение без изменений. `src/code-agent/loop-helpers.mjs` распознаёт обещание следующего действия даже для короткого «ну что?» после чтений; запрошенные планы и объяснения допускаются. `run.mjs` продолжает loop для такого текста и `finish`, сохраняет parent/native tool result; общий лимит повторов завершает задачу с `failed: true`. Исправление зеркалировано в VS Code.

История DeepSeek подтвердила новую ошибку: JSON `append_file` с буквальными переносами строки сопровождался только закрывающими тегами DSML. Парсер выбрасывал исключение раньше разбора JSON. `client.mjs` теперь принимает workspace JSON, когда отсутствует открывающий DSML; настоящие DSML-вызовы сохраняют строгую валидацию. Фактический upstream ответ разбирается с неизменным содержимым 6510 bytes.

## Проверки

`test/deepseek-dsml.test.mjs`: четыре regression сначала падали. Теперь проходят, включая воспроизведение скриншота и полный mocked code loop: чтение настоящего временного файла → продолжение с содержимым → итоговый ответ без DSML.

`node --test --test-reporter=dot test/deepseek*.test.mjs test/code-agent*.test.mjs test/tool-call-json-repair.test.mjs` passed. `npm run check:ci`, VS Code build, mirrors и `git diff --check` passed.

`test/code-agent-pending-work.test.mjs`: 6/7 сначала падали; теперь 7/7 проходят. Реальные временные файлы: read → обещание текстом/JSON finish/native finish → write → итог; сохранение parent, ограничение повторов, объяснения/планы/допустимый итог. Focused DeepSeek/code-agent suite и `npm run check:ci` passed.

Два новых hybrid regression сначала падали; теперь DSML tests 6/6, включая однократный append настоящего временного файла, parent chain и отказ для отдельных закрывающих тегов без JSON. Focused suite и CI/build снова passed; mirrors и diff-check passed.

Последний полный `npm test`: 1268/1270. Оставшиеся падения: `qwen-baxia-solver.test.mjs` и Qwen case в `transport-metrics.test.mjs`; воспроизводятся отдельно, относятся к Qwen cooldown/pacing. Qwen в этой задаче не изменялся.

После DSML исправления SYNVOX был перезапущен. Для нового исправления преждевременного завершения повторный перезапуск пока отложен: API показывает активную задачу. Сервер отвечает на4317. Живой новый запрос DeepSeek и повтор исходной пользовательской задачи не отправлялись. Ранее сохранённое сообщение со служебной разметкой остаётся в истории.
