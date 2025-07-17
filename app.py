import pickle
import pandas as pd
import requests
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from sklearn.metrics.pairwise import cosine_similarity
import nltk
from nltk.sentiment.vader import SentimentIntensityAnalyzer
import os

# --- Configuration ---
TMDB_API_KEY = os.getenv("TMDB_API_KEY")

# --- Initialize App and NLTK ---
app = Flask(__name__)
CORS(app)

try:
    nltk.data.find('sentiment/vader_lexicon.zip')
except LookupError: # <-- this is the change needed
    nltk.download('vader_lexicon', quiet=True)
analyzer = SentimentIntensityAnalyzer()

# --- Load Model Files ---
try:
    movies_df = pickle.load(open('movies_processed.pkl', 'rb'))
    vectors = pickle.load(open('movie_vectors.pkl', 'rb'))
    print("✅ Model and data loaded successfully.")
except FileNotFoundError:
    print("❌ ERROR: .pkl files not found.")
    exit()

# --- Helper Functions ---
def fetch_tmdb_details(tmdb_id):
    if pd.isna(tmdb_id): return None
    try:
        url = f"https://api.themoviedb.org/3/movie/{int(tmdb_id)}?api_key={TMDB_API_KEY}&append_to_response=credits,reviews"
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        data = response.json()

        if data.get('success') is False or not data.get('title'):
            return None

        poster_path = data.get('poster_path')
        full_poster_url = f"https://image.tmdb.org/t/p/w500{poster_path}" if poster_path else None
        crew = data.get('credits', {}).get('crew', [])
        director_info = next((p for p in crew if p.get("job") == "Director"), None)
        writer_info = next((p for p in crew if p.get("job") in ['Screenplay', 'Writer']), None)

        return {
            "tmdb_id": data.get('id'),
            "title": data.get('title'),
            "overview": data.get('overview'),
            "poster_url": full_poster_url,
            "cast": data.get('credits', {}).get('cast', []),
            "crew": data.get('credits', {}).get('crew', []),  # include crew for director
            "reviews": data.get('reviews', {}).get('results', []),
            "release_date": data.get('release_date'),
            "vote_average": data.get('vote_average'),
            "budget": data.get('budget'),
            "revenue": data.get('revenue'),
            "genres": [g['name'] for g in data.get('genres', [])],
            "production_companies": [c['name'] for c in data.get('production_companies', [])],
            "runtime": data.get('runtime'),
            "director": director_info,
            "writer": writer_info
        }
    except Exception as e:
        print(f"Error fetching details for TMDB ID {tmdb_id}: {e}")
        return None


def recommend(movie_title, num_to_fetch=20):
    """Gets a stable list of the top recommended movie info from our local data."""
    try:
        movie_index = movies_df[movies_df['title'].str.lower() == movie_title.lower()].index[0]
    except IndexError:
        return []
    
    similarity_scores = cosine_similarity(vectors[movie_index], vectors)[0]
    similar_movies_indices = similarity_scores.argsort()[-(num_to_fetch + 1):-1][::-1]
    return [movies_df.iloc[i] for i in similar_movies_indices]

# --- Page Rendering Routes ---
@app.route('/')
def home():
    return render_template('index.html')

@app.route('/sentiment_page')
def sentiment_page():
    return render_template('sentiment.html', tmdb_id=request.args.get('tmdb_id'), title=request.args.get('title'))

@app.route('/api/recommend')
def api_recommendations():
    movie_title = request.args.get('title')
    if not movie_title:
        return jsonify({"error": "Title required."}), 400

    recommended_movies_info = recommend(movie_title, num_to_fetch=20)
    if not recommended_movies_info:
        return jsonify({"error": f"Movie '{movie_title}' not found."}), 404

    final_recommendations = []
    for movie_info in recommended_movies_info[:10]:
        tmdb_id = movie_info.get("tmdb_id")
        title = movie_info.get("title")

        # Call TMDB only to get poster path (not full details)
        try:
            response = requests.get(
                f"https://api.themoviedb.org/3/movie/{int(tmdb_id)}?api_key={TMDB_API_KEY}",
                timeout=5
            )
            response.raise_for_status()
            data = response.json()
            poster_path = data.get("poster_path")
            poster_url = f"https://image.tmdb.org/t/p/w500{poster_path}" if poster_path else "https://placehold.co/500x750/1f2937/9ca3af?text=No+Poster"
        except:
            poster_url = "https://placehold.co/500x750/1f2937/9ca3af?text=No+Poster"

        final_recommendations.append({
            "tmdb_id": tmdb_id,
            "title": title,
            "poster_url": poster_url
        })

    return jsonify(final_recommendations)

@app.route('/api/details/<int:tmdb_id>')
def api_movie_details(tmdb_id):
    details = fetch_tmdb_details(tmdb_id)
    if not details:
        return jsonify({"error": "Could not fetch movie details"}), 404

    return jsonify({
        "tmdb_id": details["tmdb_id"],
        "title": details["title"],
        "poster_url": details.get("poster_url") or "https://placehold.co/500x750/1f2937/9ca3af?text=No+Poster",
        "overview": details.get("overview", "No overview available."),
        "release_date": details.get("release_date", ""),
        "vote_average": details.get("vote_average", 0),
        "genres": details.get("genres", []),
        "production_companies": details.get("production_companies", []),
        "budget": details.get("budget", 0),
        "revenue": details.get("revenue", 0),
        "runtime": details.get("runtime", 0),
        "cast": details.get("cast", [])[:8],
        "reviews": details.get("reviews", [])[:10],
        "director": details.get("director")
    })

@app.route('/api/sentiment')
def api_sentiment():
    tmdb_id = request.args.get('tmdb_id')
    if not tmdb_id: return jsonify({"error": "TMDB ID required."}), 400
        
    details = fetch_tmdb_details(tmdb_id)
    if not details: return jsonify({"error": "Could not fetch reviews."}), 404
        
    reviews_data = []
    for review in details.get('reviews', [])[:25]:
        score = analyzer.polarity_scores(review.get('content', ''))['compound']
        label = "Positive" if score >= 0.05 else "Negative" if score <= -0.05 else "Neutral"
        reviews_data.append({
            "author": review.get('author', 'Anonymous'), "content": review.get('content'),
            "label": label, "score": round(score, 2)
        })
        
    total = len(reviews_data)
    summary = {
        "total": total,
        "positive_percent": round((sum(1 for r in reviews_data if r['label'] == 'Positive') / total) * 100) if total > 0 else 0,
        "neutral_percent": round((sum(1 for r in reviews_data if r['label'] == 'Neutral') / total) * 100) if total > 0 else 0,
        "negative_percent": round((sum(1 for r in reviews_data if r['label'] == 'Negative') / total) * 100) if total > 0 else 0
    }
    return jsonify({"title": details.get('title'), "reviews": reviews_data, "summary": summary})

@app.route('/api/autocomplete')
def api_autocomplete():
    query = request.args.get('query', '').lower()
    if not query: return jsonify([])
    matches = movies_df[movies_df['title'].str.lower().str.startswith(query)]
    return jsonify(matches['title'].head(10).tolist())

@app.route('/api/actor/<int:actor_id>')
def api_actor_details(actor_id):
    try:
        url = f"https://api.themoviedb.org/3/person/{actor_id}?api_key={TMDB_API_KEY}&append_to_response=movie_credits"
        response = requests.get(url, timeout=5)
        response.raise_for_status()
        data = response.json()

        if data.get('success') is False: return jsonify({"error": "Actor not found"}), 404
        
        movie_credits = data.get('movie_credits', {}).get('cast', [])
        sorted_movies = sorted(movie_credits, key=lambda x: x.get('popularity', 0), reverse=True)
        
        return jsonify({
            "name": data.get('name'),
            "biography": data.get('biography'),
            "profile_path": f"https://image.tmdb.org/t/p/w400{data.get('profile_path')}" if data.get('profile_path') else "https://placehold.co/400x600/1f2937/9ca3af?text=No+Photo",
            "filmography": [{"title": m.get('title'), "character": m.get('character')} for m in sorted_movies[:10]]
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- Run the App ---
if __name__ == '__main__':
    app.run(debug=True, port=5000)
