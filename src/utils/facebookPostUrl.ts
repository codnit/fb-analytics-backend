type FacebookPostLink = {
  fb_page_id?: string | null;
  fb_post_id?: string | null;
  permalink?: string | null;
};

const isFacebookUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      && (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com"));
  } catch {
    return false;
  }
};

export const getFacebookPostUrl = (post?: FacebookPostLink | null): string | null => {
  const permalink = post?.permalink?.trim();
  if (permalink && isFacebookUrl(permalink)) return permalink;

  const pageId = post?.fb_page_id?.trim();
  const facebookPostId = post?.fb_post_id?.trim();
  if (!pageId || !facebookPostId) return null;

  const postId = facebookPostId.includes("_")
    ? facebookPostId.split("_").pop()
    : facebookPostId;

  return postId ? `https://www.facebook.com/${pageId}/posts/${postId}` : null;
};
