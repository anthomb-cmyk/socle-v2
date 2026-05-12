import { describe, expect, it } from "vitest";
import { extractPhonesFromValue } from "../phone-utils";

describe("extractPhonesFromValue", () => {
  it("extracts formatted and compact NANP phone numbers", () => {
    expect(extractPhonesFromValue("Téléphone: (450) 518-2614")).toEqual(["+14505182614"]);
    expect(extractPhonesFromValue("5145551234")).toEqual(["+15145551234"]);
  });

  it("does not extract a phone from the middle of a longer tracking id", () => {
    expect(extractPhonesFromValue('content="716257138534282"')).toEqual([]);
  });

  it("ignores HTML metadata and scripts while keeping visible and tel-link phones", () => {
    const html = `
      <meta property="fb:app_id" content="716257138534282" />
      <script src="https://connect.facebook.net/sdk.js?appId=716257138534282"></script>
      <a href="tel:(450)518-2614">(450) 518-2614</a>
    `;

    expect(extractPhonesFromValue(html)).toEqual(["+14505182614"]);
  });
});
