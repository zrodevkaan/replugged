import React from "@common/react";
import { Logger } from "@replugged";
import type { User } from "discord-types/general";
import { Injector } from "../../modules/injector";
import { filters, getByProps, waitForModule } from "../../modules/webpack";
import { generalSettings } from "../settings/pages/General";
import { APIBadges, BadgeSizes, Custom, badgeElements } from "./badge";

const injector = new Injector();

const logger = Logger.coremod("Badges");

interface BadgeModArgs {
  user: User;
  size: BadgeSizes;
}

type BadgeMod = (args: BadgeModArgs) => React.ReactElement<{
  children: React.ReactElement[];
  className: string;
}>;

interface BadgeCache {
  badges: APIBadges;
  lastFetch: number;
}

// todo: guilds
const cache = new Map<string, BadgeCache>();
const REFRESH_INTERVAL = 1000 * 60 * 30;

export async function start(): Promise<void> {
  const mod = await waitForModule<Record<string, BadgeMod>>(filters.bySource("getBadges()"));
  const fnPropName = Object.entries(mod).find(([_, v]) => typeof v === "function")?.[0];
  if (!fnPropName) {
    throw new Error("Could not find badges function");
  }

  const { containerWithContent } = getByProps<
    "containerWithContent",
    Record<"containerWithContent", string>
  >("containerWithContent")!;

  injector.after(
    mod,
    fnPropName,
    (
      [
        {
          user: { id },
          size,
        },
      ],
      res,
    ) => {
      try {
        if (!generalSettings.get("badges")) return res;

        const [badges, setBadges] = React.useState<APIBadges | undefined>();

        React.useEffect(() => {
          (async () => {
            if (!cache.has(id) || cache.get(id)!.lastFetch < Date.now() - REFRESH_INTERVAL) {
              cache.set(
                id,
                // TODO: new backend
                await fetch(`${generalSettings.get("apiUrl")}/api/v1/users/${id}`)
                  .then(async (res) => {
                    const body = (await res.json()) as Record<string, unknown> & {
                      badges: APIBadges;
                    };

                    if (res.status === 200 || res.status === 404) {
                      return {
                        badges: body.badges || {},
                        lastFetch: Date.now(),
                      };
                    }

                    cache.delete(id);
                    return {
                      badges: {},
                      lastFetch: Date.now(),
                    };
                  })
                  .catch((e) => e),
              );
            }

            setBadges(cache.get(id)?.badges);
          })();
        }, []);

        if (!badges) {
          return res;
        }

        const children = res?.props?.children;
        if (!children || !Array.isArray(children)) {
          logger.error("Error injecting badges: res.props.children is not an array", { children });
          return res;
        }

        if (badges.custom?.name && badges.custom.icon) {
          children.push(<Custom url={badges.custom.icon} name={badges.custom.name} size={size} />);
        }

        badgeElements.forEach(({ type, component }) => {
          const value = badges[type];
          if (value) {
            children.push(
              React.createElement(component, {
                color: badges.custom?.color,
                size,
              }),
            );
          }
        });

        if (children.length > 0) {
          if (!res.props.className.includes(containerWithContent)) {
            res.props.className += ` ${containerWithContent}`;
          }
          if (!res.props.className.includes("replugged-badges-container")) {
            res.props.className += " replugged-badges-container";
          }
        }

        return res;
      } catch (err) {
        logger.error(err);
        return res;
      }
    },
  );
}

export function stop(): void {
  injector.uninjectAll();
}
