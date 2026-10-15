# LLVM AI Tool Use Policy

## Policy

LLVM's policy is that contributors can use whatever tools they would like to
craft their contributions, but there must be a **human in the loop**.
**Contributors must read and review all LLM-generated code or text before they
ask other project members to review it.** The contributor is always the author
and is fully accountable for their contributions. Contributors should be
sufficiently confident that the contribution is high enough quality that asking
for a review is a good use of scarce maintainer time, and they should be **able
to answer questions about their work** during review.

We expect that new contributors will be less confident in their contributions,
and our guidance to them is to **start with small contributions** that they can
fully understand to build confidence. We aspire to be a welcoming community
that helps new contributors grow their expertise, but learning involves taking
small steps, getting feedback, and iterating. Passing maintainer feedback to an
LLM doesn't help anyone grow, and does not sustain our community.

Contributors are expected to **be transparent and label contributions that
contain substantial amounts of tool-generated content**. Our policy on
labelling is intended to facilitate reviews, and not to track which parts of
LLVM are generated. Contributors should note tool usage in their pull request
description, commit message, or wherever authorship is normally indicated for
the work. For instance, use a commit message trailer like Assisted-by: <name of
code assistant>. This transparency helps the community develop best practices
and understand the role of these new tools.

This policy includes, but is not limited to, the following kinds of
contributions:

- Code, usually in the form of a pull request
- RFCs or design proposals
- Issues or security vulnerabilities
- Comments and feedback on pull requests

## Details

To ensure sufficient self review and understanding of the work, it is strongly
recommended that contributors write PR descriptions themselves (if needed,
using tools for translation or copy-editing). The description should explain
the motivation, implementation approach, expected impact, and any open
questions or uncertainties to the same extent as a contribution made without
tool assistance.

An important implication of this policy is that it bans agents that take action
in our digital spaces without human approval, such as the GitHub [`@claude`
agent](https://github.com/claude/). Similarly, automated review tools that
publish comments without human review are not allowed. However, an opt-in
review tool that **keeps a human in the loop** is acceptable under this policy.
As another example, using an LLM to generate documentation, which a contributor
manually reviews for correctness, edits, and then posts as a PR, is an approved
use of tools under this policy.

AI tools must not be used to fix GitHub issues labelled [`good first
issue`][good-first-issue]. These issues are generally not urgent, and are
intended to be learning opportunities for new contributors to get familiar with
the codebase. Whether you are a newcomer or not, fully automating the process
of fixing this issue squanders the learning opportunity and doesn't add much
value to the project. **Using AI tools to fix issues labelled as "good first
issues" is forbidden**.
