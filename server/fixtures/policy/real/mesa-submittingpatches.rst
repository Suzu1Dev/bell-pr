Consequentially, contributors can use "AI" for research etc., but all text
should be their own words. They should get to know the community through
normal communication and the community should be able to get to know them.

Disclosure is always required when "AI" was involved in the creative
process of coming up with the code, except in the following cases:

- Trivial or small changes that wouldn't be copyrightable regardless of
  "AI" involvement. For example something like a "min" function fit this
  category.
- Mechanical changes where the expected result is obvious and not up to
  interpretation, ie. when it would be the same regardless of what
  tooling was used. For example, autocomplete, refactoring the name of a
  variable and similar activities fit this category. In these cases it is
  still recommended (but not required) to disclose the tool used,
  eg. "AI", "sed", "cocinelle", etc. in order to ease the review process.

We suggest the following scheme to disclose the level "AI" tooling was
involved:

- ``Assisted-by: TOOL (OPTIONAL: MODEL)`` for when "AI" was involved in making
  decisions or also generated parts of the code.
- ``Generated-by: TOOL (OPTIONAL: MODEL)`` for when almost all the code was
  generated through "AI".
