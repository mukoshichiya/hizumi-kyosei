-- 歪矯正 ver.0.5: 非公開Bucketのうち「公開キャラクター」に紐づく画像にのみ
-- 署名付きURLを発行できるようにします。既存の管理者専用操作ポリシーは残します。
-- Supabase SQL Editor で一度だけ実行してください。

DROP POLICY IF EXISTS "Public sign published character images" ON storage.objects;

CREATE POLICY "Public sign published character images"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'character-images'
  AND (
    EXISTS (
      SELECT 1 FROM public.characters AS c
      WHERE c.is_published = TRUE AND c.main_image_path = storage.objects.name
    )
    OR EXISTS (
      SELECT 1 FROM public.character_images AS ci
      JOIN public.characters AS c ON c.id = ci.character_id
      WHERE c.is_published = TRUE AND ci.storage_path = storage.objects.name
    )
  )
);

-- 公開キャラの画像を署名付きURLで表示できます。
-- 管理者の操作権限は既存の "Admin manage character-images" ポリシーを利用。
-- 非公開に戻しても既発行URLは最大12時間ほど有効になる場合があります。
