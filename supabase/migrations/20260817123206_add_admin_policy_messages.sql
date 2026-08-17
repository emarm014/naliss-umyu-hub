-- Allow admins and moderators to read all messages
CREATE POLICY "Admin Read All Messages" ON public.messages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role IN ('super_admin', 'moderator')));
