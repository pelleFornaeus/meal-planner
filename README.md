# Meals

A meal planner that runs in your browser and works offline. Plan the week from your own recipes, and see nutrition and cost per day, week and month.

- **Recipes.** Ingredients, steps, a photo, how many portions it makes, time, nutrition per portion and the total price. Paste a list of ingredients or steps and the app splits it into lines. Change the portions to scale the ingredients.
- **Categories.** Groups like Meal, Difficulty, Cost and Time, each with its own labels. A recipe can have any number of them. Filter and sort the recipe list by them. Edit the groups in Settings.
- **Week plan.** Breakfast, lunch, dinner and snacks for each day (rename or add meals in Settings). Tap + to add a recipe or a food.
- **Batches and leftovers.** A recipe that makes 4 portions is cooked once. Tap the meal and choose **Plan leftovers** to eat the rest on other days. When you add the same recipe again, the app offers the leftovers. Each day counts only the portions eaten, and the shopping list (coming next) buys the batch once.
- **Quick-add foods.** Type `100 g Cheerios, 200 ml milk`. Foods in your list fill in by themselves, scaled to the amount; a new food is looked up.
- **Nutrition lookup.** Search USDA FoodData Central (plain foods like chicken thighs or milk) and Open Food Facts (packaged foods), or scan a barcode. Picked foods are saved to **Recipes → Foods** with their nutrition per 100 g, sizes (1 cup = 244 g) and your price (3.49 for 1 gal), so they work offline afterwards.
- **Recipe numbers from ingredients.** Tap **Find** next to an ingredient to match it to a food. The editor then works out nutrition per portion and the recipe's price; tap **Use these numbers** to fill them in.
- **Totals.** Each day shows calories, protein and cost; tap it for carbs, fat, sugar, fiber and your daily goals. The Summary tab shows cost and nutrition per week or month, with charts.

## Install on iPhone

Open the app's web address in Safari, tap **Share**, then **Add to Home Screen**. It opens full screen like a regular app and works offline.

## Your data

Data is saved on each device and works offline. Sign in under **Settings → Sync** on each device to keep them in step. It uses the same Supabase project and account as the to-do app. Photos are copied to Supabase storage so your other devices get them.

### Sync setup (one time)

In Supabase, open **SQL Editor**, paste in [`supabase/setup.sql`](supabase/setup.sql) and press **Run**. This creates the `meal_records` table and a private `meal-photos` storage folder. Each account can only see its own data. Then sign in with the account you already use for the to-do app.

## For developers

Plain HTML, CSS and JavaScript with no build step.

```sh
npm start   # serves the app at http://localhost:8000
npm test    # runs the logic tests (Node 20+)
```

- `js/model.js`: recipes, the plan, batches and leftovers, totals, parsing ingredient lines, the food list
- `js/foods.js`: units, nutrition and price for an amount, reading USDA and Open Food Facts results
- `js/lookup.js`: the online searches; `js/scanner.js`: barcode scanning (ZXing in `js/vendor`, Apache 2.0, loaded only when scanning)
- `js/app.js`: the interface
- `js/store.js`: saving to the browser
- `js/records.js`, `js/sync.js`: syncing through Supabase, one record per recipe, category group, saved food or planned meal. The newest change to each record wins.
- `js/photos.js`: shrinking photos, keeping them in IndexedDB and copying them to Supabase storage
- `sw.js`: offline support. Bump `CACHE` and add new files to `ASSETS` when releasing.
