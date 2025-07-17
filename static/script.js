document.addEventListener('DOMContentLoaded', () => {
    const TMDB_API_KEY = '02ca13db6bc6d28a10bbc751710b0af3';
    const TMDB_API_URL = 'https://api.themoviedb.org/3';
    const API_URL = '/api';

    const searchInput = document.getElementById('search-input');
    const movieDetailsContainer = document.getElementById('movie-details-container');
    const initialPrompt = document.getElementById('initial-prompt');
    const recommendationGrid = document.getElementById('recommendation-grid');
    const recommendationsTitle = document.getElementById('recommendations-title');
    const loader = document.getElementById('loader');
    const errorMessage = document.getElementById('error-message');
    const autocompleteList = document.getElementById('autocomplete-list');
    const actorModal = document.getElementById('actor-modal');
    const actorModalBody = document.getElementById('actor-modal-body');
    const closeModalBtn = document.querySelector('.close-button');

    async function fetchFromAPI(url) {
        errorMessage.classList.add('hidden');
        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: response.statusText }));
                throw new Error(errData.error || "API request failed.");
            }
            return await response.json();
        } catch (error) {
            showError(error.message);
            throw error;
        }
    }

    async function getAndDisplayMovie(movieTitle) {
    showLoader(true);
    movieDetailsContainer.classList.add('hidden');
    initialPrompt.classList.add('hidden');

    try {
         // First, search TMDB for the movie ID as a fallback
        const searchUrl = `${TMDB_API_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(movieTitle)}`;
        const searchData = await fetchFromAPI(searchUrl);
        if (!searchData || !searchData.results.length) {
            throw new Error(`Movie "${movieTitle}" not found.`);
        }
        // Use the found ID and original title to process details from your backend
        await processMovieDetails(searchData.results[0].id, movieTitle);

    } catch (error) {
        showError(error.message);
    } finally {
        showLoader(false);
    }
}

async function processMovieDetails(tmdbId, movieTitle) {
    // Fetch movie details AND recommendations from YOUR backend in parallel
    const detailsPromise = fetchFromAPI(`${API_URL}/details/${tmdbId}`);
    const recommendationsPromise = fetchFromAPI(`${API_URL}/recommend?title=${encodeURIComponent(movieTitle)}`);

    const [details, recommendations] = await Promise.all([detailsPromise, recommendationsPromise]);

    if (details) {
        displayMovieDetails(details);
    }
    if (recommendations) {
        displayRecommendations(recommendations, `Recommendations for ${details.title}`);
    }
}

function displayMovieDetails(details) {
    // --- 1. The HTML structure is simplified to use ONE grid for everyone ---
    movieDetailsContainer.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8 my-8">
            <div class="md:col-span-1">
                <img src="${details.poster_url}" alt="Movie Poster" class="rounded-lg shadow-lg w-full">
            </div>
            <div class="md:col-span-2">
                <h2 class="text-4xl font-bold mb-2">${details.title}</h2>
                <div class="flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-400 mb-4">
                    <span>${details.release_date || ''}</span>
                    ${details.genres ? `<span>|</span><span>${details.genres.join(', ')}</span>` : ''}
                    ${details.runtime ? `<span>|</span><span>${details.runtime} min</span>` : ''}
                </div>
                <p class="text-gray-300 mb-4">${details.overview || 'No overview available.'}</p>

                <h3 class="text-2xl font-bold mt-6 mb-2 border-l-4 border-yellow-400 pl-3">Cast & Crew</h3>
                <div id="people-grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4"></div>

                <div class="mt-6">
                    <a href="/sentiment_page?tmdb_id=${details.tmdb_id}&title=${encodeURIComponent(details.title)}" target="_blank" class="inline-block bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded">Analyze Reviews</a>
                </div>
            </div>
        </div>`;

    // --- 2. The logic now combines the director and cast BEFORE creating the cards ---
    const peopleGrid = document.getElementById('people-grid');
    let peopleToDisplay = [];

    // Add the director to the list first, if they exist
    if (details.director) {
        peopleToDisplay.push({ ...details.director, role: 'Director' });
    }

    // Add the top 7 cast members to the list
    if (details.cast) {
        const castMembers = details.cast.slice(0, 7).map(member => ({ ...member, role: member.character }));
        peopleToDisplay.push(...castMembers);
    }

    // --- 3. A single loop now creates cards for everyone in the combined list ---
    peopleToDisplay.forEach(person => {
        const card = document.createElement('div');
        card.className = 'text-center cursor-pointer';
        card.dataset.actorId = person.id;
        card.innerHTML = `
            <img src="${person.profile_path ? `https://image.tmdb.org/t/p/w200${person.profile_path}` : 'https://placehold.co/200x300/1a202c/ffffff?text=No+Photo'}" alt="${person.name}" class="rounded-full w-20 h-20 mx-auto object-cover">
            <p class="mt-2 text-sm font-semibold">${person.name}</p>
            <p class="text-xs text-gray-400">${person.role}</p>`;
        card.addEventListener('click', () => showActorDetails(person.id));
        peopleGrid.appendChild(card);
    });

    movieDetailsContainer.classList.remove('hidden');
    initialPrompt.classList.add('hidden');
}

    function displayRecommendations(movies, title) {
    recommendationsTitle.textContent = title;
    recommendationGrid.innerHTML = '';
    movies.forEach(movie => {
        recommendationGrid.innerHTML += `
            <div class="movie-card bg-gray-800 rounded-lg overflow-hidden shadow-lg cursor-pointer" data-tmdb-id="${movie.tmdb_id}" data-title="${movie.title}">
                <img src="${movie.poster_url}" alt="${movie.title}" class="w-full h-auto">
                <div class="p-3"><h3 class="font-bold text-sm truncate">${movie.title}</h3></div>
            </div>`;
    });
}



    searchInput.addEventListener('input', async function(e) {
        const query = e.target.value;
        closeAllLists();
        if (!query || query.length < 2) return;

        const suggestions = await fetchFromAPI(`${API_URL}/autocomplete?query=${query}`);
        if (suggestions) {
            autocompleteList.innerHTML = '';
            suggestions.forEach(suggestion => {
                const item = document.createElement('div');
                item.innerHTML = `<strong>${suggestion.substr(0, query.length)}</strong>${suggestion.substr(query.length)}`;
                item.addEventListener('click', () => {
                    searchInput.value = suggestion;
                    getAndDisplayMovie(suggestion);
                    closeAllLists();
                });
                autocompleteList.appendChild(item);
            });
        }
    });

    async function showActorDetails(actorId) {
        actorModalBody.innerHTML = '<div class="loader"></div>';
        actorModal.style.display = "block";
        try {
            const actorDetails = await fetchFromAPI(`${API_URL}/actor/${actorId}`);
            actorModalBody.innerHTML = `
                <div class="flex flex-col md:flex-row gap-6">
                    <img src="${actorDetails.profile_path}" class="w-48 h-72 object-cover rounded-lg">
                    <div>
                        <h2 class="text-3xl font-bold">${actorDetails.name}</h2>
                        <p class="text-gray-400 mt-4 max-h-48 overflow-y-auto">${actorDetails.biography || "No biography available."}</p>
                        <h3 class="text-xl font-bold mt-4">Known For:</h3>
                        <ul class="list-disc list-inside text-gray-300">
                            ${actorDetails.filmography.map(f => `<li>${f.title} (${f.character})</li>`).join('')}
                        </ul>
                    </div>
                </div>`;
        } catch (error) {
            actorModalBody.innerHTML = '<p>Could not load actor details.</p>';
        }
    }

    function closeAllLists() { autocompleteList.innerHTML = ''; }
    document.addEventListener('click', (e) => { if (e.target !== searchInput) closeAllLists(); });
    closeModalBtn.onclick = () => actorModal.style.display = "none";
    window.onclick = (event) => { if (event.target == actorModal) actorModal.style.display = "none"; }
    function showLoader(isLoading) { loader.classList.toggle('hidden', !isLoading); }
    function showError(message) {
        errorMessage.textContent = `Error: ${message}`;
        errorMessage.classList.remove('hidden');
        setTimeout(() => errorMessage.classList.add('hidden'), 5000);
    }
    window.goHome = () => { window.location.href = '/'; }

    async function init() {
        showLoader(true);
        try {
            const popularData = await fetchFromAPI(`${TMDB_API_URL}/movie/popular?api_key=${TMDB_API_KEY}`);
            if (popularData && popularData.results) {
                const popularMovies = popularData.results.map(m => ({ tmdb_id: m.id, title: m.title, poster_url: `https://image.tmdb.org/t/p/w500${m.poster_path}` }));
                displayRecommendations(popularMovies, "Popular Movies");
            }
        } catch (error) {
            showError("Could not load popular movies.");
        } finally {
            showLoader(false);
        }
    }

    searchInput.addEventListener('keyup', e => {
        if (e.key === 'Enter' && searchInput.value.trim()) {
            getAndDisplayMovie(searchInput.value.trim());
            closeAllLists();
        }
    });
    recommendationGrid.addEventListener('click', e => {
    const card = e.target.closest('.movie-card');
    if (!card) return;
    const tmdbId = card.dataset.tmdbId;
    const title = card.dataset.title;
    if (tmdbId && title) {
        showLoader(true);
        processMovieDetails(tmdbId, title).finally(() => showLoader(false));
    }
});


    init();
});
