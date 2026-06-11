import { Stack } from 'expo-router';

export default function NotepadLayout() {
    return (
        <Stack>
            <Stack.Screen 
                name="index" 
                options={{ 
                    title: 'Academic Notepad', 
                    headerStyle: { backgroundColor: '#005A36' },
                    headerTintColor: '#fff'
                }} 
            />
            <Stack.Screen 
                name="create" 
                options={{ 
                    headerShown: false,
                    presentation: 'modal'
                }} 
            />
        </Stack>
    );
}
