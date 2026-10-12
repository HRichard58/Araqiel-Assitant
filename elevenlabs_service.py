import os
from elevenlabs.client import ElevenLabs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_key_file(path):
    """Lit un fichier .key en gérant le BOM (utf-8-sig) et d'éventuels guillemets
    collés autour de la clé, pour éviter une clé 'invalide' à cause d'un caractère
    invisible en tête de fichier."""
    with open(path, "r", encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if len(line) >= 2 and line[0] == line[-1] and line[0] in ("'", '"'):
                line = line[1:-1].strip()
            return line
    return ""


# Charger la clé API depuis elevenlabs.key ou l'environnement
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
if not ELEVENLABS_API_KEY:
    key_file = os.path.join(BASE_DIR, "elevenlabs.key")
    if os.path.exists(key_file):
        ELEVENLABS_API_KEY = _load_key_file(key_file)

VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "votre_id_vocal_ici")
VOICE_SETTINGS = {
    "stability": 0.38,
    "similarity_boost": 0.86,
    "style": 0.32,
    "use_speaker_boost": True,
}
MODEL_ID = "eleven_multilingual_v2"

client = ElevenLabs(api_key=ELEVENLABS_API_KEY) if ELEVENLABS_API_KEY else None


def text_to_speech(text: str) -> bytes:
    if not client:
        raise ValueError("Clé API ElevenLabs introuvable. Vérifie le fichier elevenlabs.key.")

    if not text.strip():
        raise ValueError("Le texte fourni est vide.")

    # Syntaxe officielle ElevenLabs SDK v1.x
    audio_generator = client.text_to_speech.convert(
        voice_id=VOICE_ID,
        model_id=MODEL_ID,
        text=text[:900],
        output_format="mp3_44100_128",
        voice_settings=VOICE_SETTINGS
    )

    return b"".join(audio_generator)


if __name__ == "__main__":
    print("Test de la voix ElevenLabs...")
    try:
        audio_data = text_to_speech("Bonjour Hugo, le système vocal d'Araqiel fonctionne parfaitement.")
        output_path = os.path.join(BASE_DIR, "test_output.mp3")
        with open(output_path, "wb") as f:
            f.write(audio_data)
        print(f"Audio généré avec succès : {output_path}")
    except Exception as e:
        print(f"Erreur : {e}")