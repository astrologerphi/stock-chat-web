# build a web app to display and analyze US stock market.

## app functionalities:

### stock list

each row of the list contains:

- icon, symbol and name
  - llm not needed
- market cap
  - sortable
  - llm not needed
- exchange
  - filterable
  - llm not needed
- heat
  - sortable, by the number of news in a month recently.
  - llm not needed
- float shares / total shares
  - sortable, by the percentage.
  - llm not needed
- country
  - with a filter, filter elements sorted by company numbers.
  - llm not needed
- score columns
  - llm needed
    calculated by gemini api,
    user can manage prompts in settings,
    for each prompt,
    for example: `the potential of this company, or its leader, or its product to become a popular culture symbol`
    the returned score should be formatted like:
    ```json
    {
      "score": 8,
      "reason": "more and more people are using their products"
    }
    ```
    the score should be an integer, 0 <= score <= 10
    there will be multiple prompts, in order to save tokens, they should be requested altogether,
    only the score should be shown in list,
    don't show reasons.
- tags
  - llm needed
  - string array
  - filterable
- Last LLM Run
  - sortable
    the date time last llm task was run

some of the data should be loaded asynchronously:

- the number of news in a month recently of each company in the current page
- the number of companies of each country

### stock details

- company leaders
  - fetched from FMP API, if available
  - llm not needed
- all the info in a list row
- reason of the score
  - llm needed
- tags
  - llm needed
  - user can manually delete or add new tag
- SVG diagrams
  - llm needed, does gemini support direct svg code output?
  - need both horizontal and vertical, displayed according to screen type
- company introduction
  - llm needed

### prompt management

- score prompt list, each item contains:
  - a title
  - description

- SVG diagram prompts

- company introduction prompt

### settings

- gemini api key and connection test
- gemini model select
- FMP api key
- numbers of stocks displayed in a page

## LLM task and context

each LLM task produces below outputs for a single stock:

- scores and correlated reasons
- SVG diagrams
- company introduction

after each task execution, the "Last LLM Run" column should be updated

use the news, company descriptions, and other data fetched from FMP API as the context

user can batch run tasks for all the stocks in a page, or run a task for a single stock

## tech stack:

- use FMP API as the data source,
- use express.js as backend,
- use esbuild as build tool,
- use typescript 7 as the language,
- use mongoose as nodejs mongodb driver,
- use gemini api as analyze tool.
- use local mongodb for storage:
  - connection: mongodb://localhost:27017
  - database name: Local1114
  - collection name: Coll01
- use localStorage for storing secrets

you can get the secrets from ...

that's all the requirements currently, surprise me with your excellent aesthetics.
