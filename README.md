# Meals

A meal planner that runs in your browser and works offline. Plan the week from your own recipes, and see nutrition and cost per day, week and month.

- **Import recipes.** Paste a link to a recipe page and the app fills in the name, photo, portions, time, ingredients, steps and nutrition (most recipe sites include these for search engines). If a site doesn't work, copy the recipe text from the page and paste it instead. Needs the one-time setup below.
- **Recipes.** Ingredients, steps, a photo, how many portions it makes, time, nutrition per portion and the total price. Paste a list of ingredients or steps and the app splits it into lines. Change the portions to scale the ingredients.
- **Categories.** Groups like Meal, Difficulty, Cost and Time, each with its own labels. A recipe can have any number of them. Filter and sort the recipe list by them. Edit the groups in Settings.
- **Week plan.** Breakfast, lunch, dinner and snacks for each day (rename or add meals in Settings). Tap + to add a recipe or a food.
- **Batches and leftovers.** A recipe that makes 4 portions is cooked once. Tap the meal and choose **Plan leftovers** to eat the rest on other days. When you add the same recipe again, the app offers the leftovers. Each day counts only the portions eaten, and the shopping list buys the batch once.
- **Quick-add foods.** Type `100 g Cheerios, 200 ml milk`. Foods in your list fill in by themselves, scaled to the amount; a new food is looked up.
- **Nutrition lookup.** Search USDA FoodData Central (plain foods like chicken thighs or milk) and Open Food Facts (packaged foods), or scan a barcode. Picked foods are saved to **Recipes → Foods** with their nutrition per 100 g, sizes (1 cup = 244 g) and your price (3.49 for 1 gal), so they work offline afterwards.
- **Recipe numbers from ingredients.** Tap **Find** next to an ingredient to match it to a food. The editor then works out nutrition per portion and the recipe's price; tap **Use these numbers** to fill them in.
- **Shopping list.** The **Shop** tab lists what the meals from a start day for a number of days need (7 by default). Each batch is bought once, for the day it's cooked, and the same food from different recipes is added up (500 ml + 300 ml milk = 800 ml). Sort it by aisle (produce, dairy, meat…) or by recipe (the aisle is guessed from the name; tap **Wrong aisle? Move items** to fix one, and the app remembers it), and filter it to some recipes. Tick things off as you shop, add extra items like paper towels, see the estimated cost, and copy or share the list. Ticks sync between devices. If you tick off milk and later plan another meal with milk after that list's last day, it shows up again for just the new amount.
- **At home (pantry).** On the Shop tab, keep a list of what you already have. Tap the house next to a shopping item, or add things under **At home**. They're left off the list. Mark staples like salt and oil as **Always have**.
- **Favourites and ratings.** Star recipes, rate them (also from a meal you cooked), and sort by favourites, top rated, or "not made in a while". Each recipe shows how often and when you last cooked it.
- **Steps with checklists.** In the recipe editor, give a step a checklist: tap **+ Checklist item**, or **+ Ingredients** to pick from the recipe's ingredients (they scale with the portions). Move steps up and down with the arrows. Tick items off on the recipe and in cooking mode.
- **Cooking mode.** **Start cooking** shows one step at a time in big text and keeps the screen on. Times in the steps ("simmer 30 minutes") become timer buttons that ring when done.
- **Surprise me.** Rolls the dice on your recipes (or on the ones for that meal when adding to a day). Favourites and dishes you haven't had in a while come up more often.
- **Copy last week.** One tap at the bottom of the Plan tab repeats last week's meals.
- **Price history.** Every time a food's price changes, the old one is kept. The food shows a small chart of its price over time, and the Foods list marks foods that went up or down.
- **Receipt scanning.** Under **Recipes → Foods** (or at the bottom of the Shop tab), take a photo of a grocery receipt. The app reads it on your phone, matches each line to one of your foods and updates the prices. It remembers your matches for next time. You can also paste receipt text.
- **Auto-plan my week.** On the Plan tab, pick the days and meals and the app fills the empty ones. It picks favourites and dishes you haven't had in a while, recipes that share ingredients (less waste), and things from your pantry that need using. It plans leftovers from big batches and fits your calorie goal and budget. Shuffle until you like it, then add it to the plan.
- **Use it up.** Give pantry items a use-by date and the Plan tab suggests recipes that use them before they go off.
- **Year in food.** Summary → Year in food: your dish of the year, meals and batches cooked, money spent each month, favourite ingredients, top rated, and the new recipes you tried.
- **Totals.** Each day shows calories, protein and cost; tap it for carbs, fat, sugar, fiber and your daily goals. The Summary tab shows cost and nutrition per week or month, with charts.

## Install on iPhone

Open the app's web address in Safari, tap **Share**, then **Add to Home Screen**. It opens full screen like a regular app and works offline.

## Your data

Data is saved on each device and works offline. Sign in under **Settings → Sync** on each device to keep them in step. It uses the same Supabase project and account as the to-do app. Photos are copied to Supabase storage so your other devices get them.

### Sync setup (one time)

In Supabase, open **SQL Editor**, paste in [`supabase/setup.sql`](supabase/setup.sql) and press **Run**. This creates the `meal_records` table and a private `meal-photos` storage folder. Each account can only see its own data. Then sign in with the account you already use for the to-do app.

### Recipe import setup (one time)

Browsers can't read other websites directly, so the app asks a small Supabase function to fetch the recipe page for it. Only people signed in to the app can use it.

1. In Supabase, open **Edge Functions** and choose **Deploy a new function → Via Editor**.
2. Name it exactly `recipe-import`.
3. Delete the sample code and paste in everything from [`supabase/functions/recipe-import/index.ts`](https://raw.githubusercontent.com/pelleFornaeus/meal-planner/main/supabase/functions/recipe-import/index.ts).
4. Press **Deploy function**.
5. Open the function's **Settings**, turn **Verify JWT** off, and save. (The function checks the sign-in itself; Supabase's own check doesn't work with this project's newer keys and blocks every request.)

(With the Supabase command line tool instead: `supabase functions deploy recipe-import --no-verify-jwt --project-ref ytxfjvfayvhwoaybyyqp`.)

## For developers

Plain HTML, CSS and JavaScript with no build step.

```sh
npm start   # serves the app at http://localhost:8000
npm test    # runs the logic tests (Node 20+)
```

- `js/model.js`: recipes, the plan, batches and leftovers, totals, parsing ingredient lines, the food list
- `js/foods.js`: units, nutrition and price for an amount, reading USDA and Open Food Facts results
- `js/lookup.js`: the online searches; `js/scanner.js`: barcode scanning (ZXing in `js/vendor`, Apache 2.0, loaded only when scanning)
- `js/receipt.js`: price history and reading receipts; `js/ocr.js`: reading text from a photo with Tesseract (`js/vendor/tesseract`, Apache 2.0, loaded only when scanning a receipt)
- `js/extras.js`: copy a week, last cooked, Surprise me, timers in steps
- `js/planner.js`: auto-plan and Use it up; `js/recap.js`: Year in food
- `js/app.js`: the interface
- `js/store.js`: saving to the browser
- `js/records.js`, `js/sync.js`: syncing through Supabase, one record per recipe, category group, saved food or planned meal. The newest change to each record wins.
- `js/photos.js`: shrinking photos, keeping them in IndexedDB and copying them to Supabase storage
- `sw.js`: offline support. Bump `CACHE` and add new files to `ASSETS` when releasing.
