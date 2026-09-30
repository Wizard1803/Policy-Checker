const js = require("@eslint/js");

module.exports = [
  {
    ignores: [
      ".agents/**",
      "outputs/**",
      "node_modules/**",
      "public/vendor/**",
      "coverage/**"
    ]
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        module: "readonly",
        require: "readonly",
        Buffer: "readonly",
        jest: "readonly",
        describe: "readonly",
        test: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        AbortController: "readonly",
        document: "readonly",
        window: "readonly",
        alert: "readonly",
        fetch: "readonly",
        navigator: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
      "no-console": "off",
    }
  }
];
