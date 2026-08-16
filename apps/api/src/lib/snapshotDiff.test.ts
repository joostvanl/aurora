import { describe, expect, it } from "vitest";
import {
  diffContentTypeSnapshots,
  diffEntrySnapshots,
} from "./snapshotDiff.js";

describe("diffEntrySnapshots", () => {
  it("returns empty for identical snapshots", () => {
    const snap = {
      slug: "home",
      status: "draft",
      locale: "en-US",
      fields: { title: "Hello" },
    };
    expect(diffEntrySnapshots(snap, snap)).toEqual([]);
  });

  it("reports meta and field changes", () => {
    const changes = diffEntrySnapshots(
      {
        slug: "a",
        status: "draft",
        locale: "en-US",
        fields: { title: "Old", body: "x" },
      },
      {
        slug: "b",
        status: "published",
        locale: "en-US",
        fields: { title: "New" },
      },
    );
    expect(changes).toEqual(
      expect.arrayContaining([
        { path: "slug", before: "a", after: "b" },
        { path: "status", before: "draft", after: "published" },
        { path: "fields.title", before: "Old", after: "New" },
        { path: "fields.body", before: "x", after: undefined },
      ]),
    );
  });
});

describe("diffContentTypeSnapshots", () => {
  it("reports added and changed fields", () => {
    const changes = diffContentTypeSnapshots(
      {
        apiId: "page",
        name: "Page",
        description: null,
        localizationMode: "explicit",
        fields: [
          {
            apiId: "title",
            name: "Title",
            type: "text",
            required: true,
            sortOrder: 0,
            settings: null,
          },
        ],
      },
      {
        apiId: "page",
        name: "Page",
        description: "desc",
        localizationMode: "explicit",
        fields: [
          {
            apiId: "title",
            name: "Headline",
            type: "text",
            required: true,
            sortOrder: 0,
            settings: null,
          },
          {
            apiId: "body",
            name: "Body",
            type: "textarea",
            required: false,
            sortOrder: 1,
            settings: null,
          },
        ],
      },
    );
    expect(changes).toEqual(
      expect.arrayContaining([
        { path: "description", before: null, after: "desc" },
        {
          path: "fields.title.name",
          before: "Title",
          after: "Headline",
        },
        {
          path: "fields.body",
          before: undefined,
          after: expect.objectContaining({ apiId: "body" }),
        },
      ]),
    );
  });
});
