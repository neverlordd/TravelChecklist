# Telegram Travel Checklist

Совместный чеклист поездок для Telegram Mini Apps: React, Vite, Tailwind CSS, Supabase Database/Realtime/Storage и GitHub Pages.

## 1. Подготовить Supabase

1. Откройте проект Supabase.
2. Перейдите в **SQL Editor → New query**.
3. Скопируйте весь файл `supabase.sql`, нажмите **Run**.
4. В **Database → Replication** убедитесь, что `checklist_items` включена в `supabase_realtime` (SQL делает это автоматически).
5. В **Storage** должен появиться публичный bucket `photos`.

## 2. Локальный запуск

Требуется Node.js 20.19+ или 22.12+.

```bash
npm install
npm run dev
```

Откройте адрес, который покажет Vite. В режиме разработки приложение подставляет пользователя `neverlordd`; в production этого обхода нет.

Если создавать проект с нуля, эквивалентные команды:

```bash
npm create vite@latest telegram-travel-checklist -- --template react
cd telegram-travel-checklist
npm install
npm install @supabase/supabase-js lucide-react
npm install -D tailwindcss@3 postcss autoprefixer gh-pages
npx tailwindcss init -p
```

## 3. GitHub Pages

`vite.config.js` использует `base: './'`, поэтому сборка работает с любым именем GitHub-репозитория.

1. Создайте пустой репозиторий на GitHub, например `travel-checklist`.
2. В папке проекта выполните:

```bash
git init
git add .
git commit -m "Initial Telegram travel checklist"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/travel-checklist.git
git push -u origin main
npm run deploy
```

3. В репозитории откройте **Settings → Pages**.
4. В **Build and deployment** выберите **Deploy from a branch**.
5. Выберите ветку `gh-pages`, папку `/ (root)` и нажмите **Save**.
6. Приложение будет доступно по адресу `https://YOUR_GITHUB_USERNAME.github.io/travel-checklist/`.

При дальнейших изменениях:

```bash
git add .
git commit -m "Update app"
git push
npm run deploy
```

## 4. Подключить Mini App к боту

1. Откройте `@BotFather` в Telegram.
2. Выполните `/mybots` и выберите своего бота.
3. Откройте **Bot Settings → Menu Button → Configure menu button**.
4. Отправьте публичную HTTPS-ссылку GitHub Pages.
5. Задайте подпись кнопки, например `Наши поездки`.
6. Полностью закройте и снова откройте чат с ботом, затем нажмите кнопку меню.

Альтернативно используйте `/setmenubutton`, выберите бота, затем передайте текст кнопки и URL.

## Важное ограничение безопасности

Встроенный `sb_publishable_...` ключ можно безопасно публиковать только вместе с корректными RLS-политиками. Однако GitHub Pages не имеет сервера, а `initDataUnsafe.user.username` не подтвержден криптографически. Пользователь может подменить клиентский JavaScript или обратиться к Supabase API напрямую. Поэтому текущий whitelist — удобное ограничение интерфейса, но не настоящий периметр безопасности.

Для строгой защиты необходимо отправлять исходную строку `Telegram.WebApp.initData` в Supabase Edge Function, проверять HMAC-подпись с bot token на сервере и только после этого выдавать короткоживущую авторизацию; RLS должна доверять серверно проверенным claims. Никогда не помещайте bot token или `service_role` key в React-код.
