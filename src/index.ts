import { ISongShowPlusSection, ISongShowPlusSong } from './models';
import { TextCleaner } from './text-cleaner';

export class SongShowPlus {
  //Regex pattern AS A STRING to match invisible control characters
  //Slashes are double escaped here so it can be in a string!
  private readonly patternInvisibleCharsStr = '[\\xA0\\x00-\\x09\\x0B\\x0C\\x0E-\\x1F\\x7F]';
  //Same pattern, but as a real RexExp object
  private readonly patternInvisibleChars = new RegExp(this.patternInvisibleCharsStr, 'g');

  private readonly textCleaner = new TextCleaner();

  parse(fileContent: string): ISongShowPlusSong {
    let title = '';
    let artist = '';
    let copyright = '';
    let ccli = '';
    let keywords: string[] = [];
    let sections: ISongShowPlusSection[] = [];

    //We don't want any properties XML tags which can sometimes begin the file.
    //Splitting these out and then taking the first array item can prevent this.
    //Each song sections seems to be split up by a percent sign, so make an array by splitting on that
    const propSections = fileContent.split('<Properties>');
    if (propSections[0]) {
      const sectionParts = propSections[0].split('%');

      if (sectionParts.length > 0) {
        //Pass all the sections in here to get the lyrics
        //We will get out the sections and the keywords
        const sectionContent = this.getSectionsAndKeywords(sectionParts);
        keywords = sectionContent.keywords;
        sections = sectionContent.sections;

        if (sectionParts[0]) {
          //The info is all contained in the first section, so only pass that in and pass in the keywords from above
          const parsedInfo = this.getSongAttributes(sectionParts[0]);
          title = parsedInfo.title;
          artist = parsedInfo.artist;
          copyright = parsedInfo.copyright;
          ccli = parsedInfo.ccli;
        }
      }
    }

    return {
      title,
      artist,
      copyright,
      ccli,
      keywords,
      sections,
    };
  }

  private getSongAttributes(firstSection: string): {
    title: string;
    artist: string;
    copyright: string;
    ccli: string;
  } {
    //Split the info up into an array by the invisible characters
    //Then remove all empty items and items that are only 1 character long
    const infoArray = firstSection
      .split(this.patternInvisibleChars)
      .filter((n) => n.trim().replace(/\r\n\t/g, '').length > 1);

    let title = '';
    let artist = '';
    let copyright = '';
    let ccli = '';

    if (infoArray.length > 0) {
      if (infoArray[0]) {
        //If the first items is a number between 1 and 4 digits, remove it
        if (/[0-9]{1,4}/.test(infoArray[0])) {
          infoArray.splice(0, 1);
        }

        //Remove dollar signs from the title
        title = infoArray[0].replace(/\$/g, '');
      }
      if (infoArray[1]) {
        artist = this.textCleaner.convertWin1252ToUtf8(infoArray[1].trim());
      }

      //If the copyright exists, add it
      if (infoArray[2]) {
        //copyright info tends to end with a $ sign, so remove it
        copyright = this.textCleaner.convertWin1252ToUtf8(infoArray[2].replace('$', '').trim());
      }

      //If the CCLI exists, add it
      if (infoArray[3]) {
        ccli = this.textCleaner.convertWin1252ToUtf8(infoArray[3].trim());
      }
    }

    //Convert characters as needed - useful for non-UTF8 character (like accented characters in Spanish)
    //This is partially needed due to the binary file format that we are scraping for text
    title = this.textCleaner.convertWin1252ToUtf8(title);

    return {
      title,
      artist,
      copyright,
      ccli,
    };
  }

  private cleanOddCharsFromSectionTitles(lyrics: string): string {
    //Convert character encodings - useful for non-English alphabets (Spanish)
    return (
      this.textCleaner
        .convertWin1252ToUtf8(lyrics)
        //Sometime section titles will end with an odd character
        //If the last character isn't a letter, number, or closing parenthesis then remove it
        .replace(/[^a-z0-9)]$/i, '')
    );
  }

  private cleanOddCharsFromSectionLyrics(lyrics: string): string {
    return (
      //Convert character encodings - useful for non-English alphabets (Spanish)
      this.textCleaner
        .convertWin1252ToUtf8(lyrics)
        //Replace multiple slashes sometimes?
        //Also remove some strange ugly characters...
        .replace(/\/+|¶/g, '')
        //remove beginning/ending whitespace
        .trim()
        //Sometimes the first character of lyrics is a random lowercase letter
        //If we have a lowercase letter first and then an uppercase letter, remove that first character
        .replace(/^[a-z]([A-Z])/, '$1')
        //If the last characters are newlines followed by a non-letter character, remove them
        .replace(/[\n\r]+[^a-z]$/i, '')
    );
  }

  private createInitialSectionsArray(sections: string[]): ISongShowPlusSection[] {
    const sectionsArray = [];

    //Sections tend to begin with N number of control characters, a random print character,
    // more control characters, and then the title "Verse 1" or something
    //After that is the actual song lyrics, but it may be proceeded by one non-word character
    //Slashes are double escaped here so it can be in a string!
    const sectionPattern = new RegExp(
      '^' +
        this.patternInvisibleCharsStr +
        '+.{1}' +
        this.patternInvisibleCharsStr +
        '+(.+)' +
        this.patternInvisibleCharsStr +
        '+\\W*([\\s\\S]+)',
      'm'
    );

    //Loop through the sections
    //But SKIP the first one since it contains the song info we don't need here
    for (let i = 1; i < sections.length; i++) {
      const thisSection = sections[i] ?? /* istanbul ignore next */ '';
      //Run the regex on each section to split out the section title from the lyrics
      const matches = thisSection.match(sectionPattern);
      let sectionTitle = '';
      let sectionLyrics = '';

      //Remove whitespace from the title
      if (matches != null) {
        if (matches[1]) {
          sectionTitle = matches[1].replace(this.patternInvisibleChars, '').trim();
        }
        if (matches[2]) {
          //Remove any more invisible chars from the lyrics and remove whitespace
          sectionLyrics = matches[2].replace(this.patternInvisibleChars, '').trim();
        }
      }

      sectionTitle = this.cleanOddCharsFromSectionTitles(sectionTitle);
      sectionLyrics = this.cleanOddCharsFromSectionLyrics(sectionLyrics);

      //don't add sections with empty lyrics
      if (sectionLyrics !== '') {
        sectionsArray.push({
          title: sectionTitle,
          lyrics: sectionLyrics,
        });
      }
    }

    return sectionsArray;
  }

  private getSectionsAndKeywords(sections: string[]): {
    sections: ISongShowPlusSection[];
    keywords: string[];
  } {
    const sectionsArray = this.createInitialSectionsArray(sections);

    //The last section also contains the keywords, we need to parse these out separately
    const lastSectionObj = this.getKeywordsFromLastSection(sections.slice(-1)[0]);
    let keywords: string[] = [];
    if (lastSectionObj.lastLyrics !== '') {
      //If we have no sections, and what we think are keywords are longer than the lyrics...
      //Then we might need to switch them for some reason...
      if (
        sectionsArray.length === 0 &&
        lastSectionObj.keywords.length > lastSectionObj.lastLyrics.length
      ) {
        keywords = [lastSectionObj.lastLyrics];

        sectionsArray.push({
          title: '',
          lyrics: lastSectionObj.keywords.join('').replace(/\/+/g, ''),
        });
      } else {
        keywords = lastSectionObj.keywords;
        if (sectionsArray.length > 0) {
          const lastSection = sectionsArray.slice(-1)[0];
          lastSection.lyrics = lastSectionObj.lastLyrics;
        } else {
          sectionsArray.push({
            title: 'All Found Lyrics',
            lyrics: lastSectionObj.lastLyrics.replace(/\/+/g, ''),
          });
        }
      }
    }

    //Only add it if the title and the lyrics don't match. Sometimes they do for some reason...
    const finalArray = [];
    for (const s of sectionsArray) {
      if (s.title.trim().toLowerCase() !== s.lyrics.trim().toLowerCase()) {
        finalArray.push(s);
      }
    }

    return {
      sections: finalArray,
      keywords,
    };
  }

  private getKeywordsFromLastSection(lastSectionRaw: string | undefined): {
    keywords: string[];
    lastLyrics: string;
  } {
    let keywords: string[] = [];
    let lastLyrics = '';

    if (lastSectionRaw != null) {
      //Remove all empty items and items that are only 1 character long
      const infoArray = lastSectionRaw
        .split(this.patternInvisibleChars)
        .filter((n: string) => n.trim().length > 1);

      //If we have at least 3 sections, then we have keywords
      if (infoArray.length > 2) {
        //The keywords are the entire array except for the first two items
        keywords = infoArray
          .splice(2)
          .map((x) => this.textCleaner.convertWin1252ToUtf8(x.replace(/[\r\n\t]*/g, '')));

        if (infoArray.length > 0 && infoArray[1]) {
          //Return the last section minus the keywords, then parse out the optional beginning non-word character
          const lastSectionNonWordsRemoved = /^\W*([\s\S]+)/m.exec(infoArray[1]);

          if (lastSectionNonWordsRemoved?.[1] != null) {
            lastLyrics = lastSectionNonWordsRemoved[1];
          }
        }

        //Convert characters as needed - useful for non-english alphabets (Spanish)
        lastLyrics = this.cleanOddCharsFromSectionLyrics(lastLyrics);
      }
    }

    return {
      keywords,
      lastLyrics,
    };
  }
}
