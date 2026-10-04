/* Three sample recipes, written for this page. Each one exercises a different
 * corner of the scaler: baking weights and sticks of butter, cans and pounds,
 * fraction glyphs and spelled-out units. */
(function (root) {
  "use strict";
  var SAMPLES = [
    [
      "Brown Butter Chocolate Chip Cookies",
      "Makes 24 cookies",
      "",
      "Ingredients",
      "1 cup (2 sticks) unsalted butter",
      "2 1/4 cups all-purpose flour",
      "1 tsp baking soda",
      "1 tsp kosher salt",
      "1 cup packed brown sugar",
      "1/2 cup granulated sugar",
      "2 large eggs, plus 1 yolk",
      "1 Tbsp vanilla extract",
      "2 cups chocolate chips",
      "Flaky salt, to finish",
      "",
      "Method",
      "1. Brown the butter in a light pan over medium heat until it smells nutty and the bits on the bottom turn tan. Let it cool for 15 minutes.",
      "2. Heat the oven to 350°F and line two baking sheets with parchment.",
      "3. Whisk the flour, baking soda and salt together.",
      "4. Beat the cooled butter with both sugars, then the eggs, yolk and vanilla, until glossy.",
      "5. Stir in the flour, then the chips. Scoop 2-tablespoon balls onto the sheets.",
      "6. Bake 10 to 12 minutes, until the edges are golden and the middles still look soft. Finish with flaky salt."
    ],
    [
      "Weeknight Chili",
      "Serves 6",
      "",
      "2 tbsp olive oil",
      "1 1/2 lb ground beef",
      "1 large onion, diced",
      "4 cloves garlic, minced",
      "2 1/2 Tbsp chili powder",
      "2 tsp ground cumin",
      "1 tsp smoked paprika",
      "1 (28 oz) can crushed tomatoes",
      "2 (15 oz) cans kidney beans, drained",
      "1 cup beef broth",
      "1 tbsp brown sugar",
      "Salt and pepper to taste",
      "",
      "Directions",
      "Warm the oil in a heavy pot over medium-high heat. Brown the beef with the onion, breaking it up as it cooks, about 8 minutes.",
      "Stir in the garlic and spices for 1 minute, until fragrant.",
      "Add the tomatoes, beans, broth and sugar. Simmer, partly covered, for 30 to 40 minutes, stirring now and then. Season to taste."
    ],
    [
      "Lemon Olive Oil Cake",
      "Serves 8",
      "",
      "1 ¾ cups all-purpose flour",
      "1 cup sugar",
      "2 teaspoons baking powder",
      "½ teaspoon salt",
      "3 large eggs",
      "¾ cup whole milk",
      "⅔ cup olive oil",
      "Zest of 2 lemons",
      "¼ cup fresh lemon juice",
      "2 tablespoons powdered sugar, for dusting",
      "",
      "Instructions",
      "Heat the oven to 350°F. Oil a 9-inch round pan and line the bottom with parchment.",
      "Whisk the flour, baking powder and salt in a bowl.",
      "In a large bowl, rub the sugar and lemon zest together with your fingers until it smells like lemons, then whisk in the eggs, milk, oil and juice.",
      "Fold in the dry ingredients until just combined. Bake 40 to 45 minutes, until a toothpick comes out clean. Cool, then dust with powdered sugar."
    ]
  ].map(function (a) { return a.join("\n"); });
  if (typeof module !== "undefined" && module.exports) module.exports = SAMPLES;
  else root.RS_SAMPLES = SAMPLES;
})(typeof window !== "undefined" ? window : this);
