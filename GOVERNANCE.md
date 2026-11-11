# How the Open Briefing Standard is run

The Open Briefing Standard (OBS) is small on purpose, and one person can run it. This page says how decisions are made and what will never change, so a publisher or a tool builder knows what they are adopting.

## Who decides

OBS has one maintainer, [Rishi Dean](https://rishidean.com), who decides what goes into the spec and the reference tools. If that changes, this file changes first.

## How to propose a change

Open an issue with the "Propose a change" template. Say what problem a publisher or a tool has today, what tag or text would fix it, and who needs it. Discussion happens on the issue. A change that is accepted lands as a pull request that updates the spec, the fixtures and the reference parser together, and is recorded in the [changelog](CHANGELOG.md).

A proposal is more likely to be accepted when a publisher and a tool both want it, and when it can be an optional tag.

## What will not change

Version 1 is a release candidate. From the day it is final:

- **A tag's name and meaning never change, and no tag is removed.** A page tagged for version 1 stays valid.
- **A minor version only adds optional tags.** A reader of 1.0 can read any 1.x page and ignore what it does not know.
- **Anything else is a new major version,** announced by `obs:version`.
- **The namespace URL is permanent:** `https://openbriefingstandard.org/ns#`.

Until version 1 is final a tag name could still change. If one does, the changelog says so and the checker warns about the old name.

## What OBS will not become

OBS is a format. It states what a publisher intends and asks nothing of the tools that read it. It has no conformance test, no certification and no registry a publisher must join. It does not say whether content may be used at all; robots.txt and similar signals do that.

## Licences

The specification is dedicated to the public domain ([CC0 1.0](LICENSE-SPEC)). The code is [MIT](LICENSE). Contributions are accepted under the same terms.

## Releases

The reference package is released by pushing a `v*` git tag. A workflow tests, builds and publishes it to npm with provenance, and creates the GitHub release from the changelog. No one publishes by hand.

## Adopters

Publishers and tools that use OBS are listed in [`adopters.yml`](adopters.yml). To be listed, open an issue with the "List an adopter" template or send a pull request. A weekly check confirms each listed publisher still serves usable tags.
